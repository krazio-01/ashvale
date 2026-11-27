import fs from "node:fs";
import ts from "typescript";
import { PipelineCommand, listFilesRecursively } from "../pipeline";

const SOURCE_ROOT = "src";
const SOURCE_FILE_PATTERN = /\.tsx?$/;
const DECLARATION_FILE_PATTERN = /\.d\.ts$/;
const COMPONENT_NAME_PATTERN = /^[A-Z]/;
const REGISTRY_NAME_PATTERN = /registry|REGISTRY|[a-z]Factory|FACTORIES/;

enum Section {
    Directive,
    Imports,
    Constants,
    Types,
    Classes,
    Helpers,
    Registries,
}

interface IStatementEntry {
    statement: ts.Statement;
    index: number;
    section: Section;
}

interface IFileReport {
    file: string;
    firstMisplacedLine: number;
    blockedBy: string | null;
    ordered: string;
}

const declaredNamesOf = (statement: ts.Statement): string[] => {
    if (ts.isVariableStatement(statement))
        return statement.declarationList.declarations.map((declaration) =>
            declaration.name.getText()
        );
    if (
        (ts.isClassDeclaration(statement) ||
            ts.isFunctionDeclaration(statement) ||
            ts.isTypeAliasDeclaration(statement) ||
            ts.isInterfaceDeclaration(statement) ||
            ts.isEnumDeclaration(statement)) &&
        statement.name
    )
        return [statement.name.text];
    return [];
};

const isArrowConstant = (statement: ts.Statement): boolean => {
    if (!ts.isVariableStatement(statement)) return false;
    const initializer = statement.declarationList.declarations[0]?.initializer;
    return (
        !!initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
    );
};

const isStaticMember = (member: ts.ClassElement): boolean =>
    ts.canHaveModifiers(member) &&
    !!ts.getModifiers(member)?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword);

const eagerReferencesOf = (statement: ts.Statement, names: ReadonlySet<string>): Set<string> => {
    const references = new Set<string>();

    const visit = (node: ts.Node): void => {
        if (ts.isFunctionLike(node)) return;
        if (ts.isClassLike(node)) {
            node.heritageClauses?.forEach(visit);
            for (const member of node.members) {
                if (
                    ts.isPropertyDeclaration(member) &&
                    isStaticMember(member) &&
                    member.initializer
                )
                    visit(member.initializer);
                if (ts.isClassStaticBlockDeclaration(member)) visit(member.body);
            }
            return;
        }
        const isMemberName =
            !!node.parent &&
            ((ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
                (ts.isPropertyAssignment(node.parent) && node.parent.name === node));
        if (ts.isIdentifier(node) && names.has(node.text) && !isMemberName)
            references.add(node.text);
        ts.forEachChild(node, visit);
    };

    if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations)
            if (declaration.initializer) visit(declaration.initializer);
    } else if (ts.isClassDeclaration(statement) || ts.isExpressionStatement(statement))
        visit(statement);
    return references;
};

const fixedSectionOf = (statement: ts.Statement): Section | null => {
    if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression))
        return Section.Directive;
    if (ts.isImportDeclaration(statement)) return Section.Imports;
    if (ts.isVariableStatement(statement)) return Section.Constants;
    if (
        ts.isTypeAliasDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isEnumDeclaration(statement)
    )
        return Section.Types;
    if (ts.isClassDeclaration(statement)) return Section.Classes;
    if (ts.isFunctionDeclaration(statement)) return Section.Helpers;
    return null;
};

const entriesOf = (sourceFile: ts.SourceFile): IStatementEntry[] => {
    const statements = [...sourceFile.statements];
    const classNames = new Set(
        statements.filter(ts.isClassDeclaration).flatMap((statement) => declaredNamesOf(statement))
    );
    const arrowNames = new Set(
        statements.filter(isArrowConstant).flatMap((statement) => declaredNamesOf(statement))
    );
    const eagerArrowNames = new Set(
        statements
            .filter((statement) => ts.isVariableStatement(statement) && !isArrowConstant(statement))
            .flatMap((statement) => [...eagerReferencesOf(statement, arrowNames)])
    );
    const isComponentFile = sourceFile.fileName.endsWith("x");

    let neighbourSection = Section.Constants;
    return statements.map((statement, index) => {
        const name = declaredNamesOf(statement)[0] ?? "";
        let section = fixedSectionOf(statement);

        if (section === Section.Directive) return { statement, index, section };
        if (isArrowConstant(statement)) {
            if (eagerArrowNames.has(name)) section = Section.Constants;
            else if (isComponentFile && COMPONENT_NAME_PATTERN.test(name)) {
                section = Section.Classes;
                neighbourSection = section;
            } else section = Math.max(neighbourSection, Section.Constants);
        } else if (section === null) section = neighbourSection;
        else {
            if (
                section === Section.Constants &&
                (REGISTRY_NAME_PATTERN.test(name) ||
                    eagerReferencesOf(statement, classNames).size > 0)
            )
                section = Section.Registries;
            neighbourSection = section;
        }
        return { statement, index, section };
    });
};

const orderViolationOf = (
    ordered: readonly IStatementEntry[],
    names: ReadonlySet<string>
): string | null => {
    const position = new Map<string, number>();
    const hoisted = new Set<string>();
    ordered.forEach(({ statement }, slot) => {
        const isHoisted =
            ts.isFunctionDeclaration(statement) ||
            ts.isTypeAliasDeclaration(statement) ||
            ts.isInterfaceDeclaration(statement);
        for (const name of declaredNamesOf(statement)) {
            position.set(name, slot);
            if (isHoisted) hoisted.add(name);
        }
    });
    for (const [slot, { statement }] of ordered.entries()) {
        const own = declaredNamesOf(statement);
        for (const reference of eagerReferencesOf(statement, names)) {
            if (hoisted.has(reference) || own.includes(reference)) continue;
            if ((position.get(reference) ?? -1) >= slot)
                return `${own[0] ?? "statement"} needs ${reference} above it`;
        }
    }
    return null;
};

const reportOf = (file: string): IFileReport | null => {
    const text = fs.readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const entries = entriesOf(sourceFile);
    const ordered = [...entries].sort((a, b) => a.section - b.section || a.index - b.index);
    const firstMisplaced = entries.findIndex((entry, slot) => entry !== ordered[slot]);
    if (firstMisplaced < 0) return null;

    const names = new Set(entries.flatMap(({ statement }) => declaredNamesOf(statement)));
    const joined = ordered
        .map(({ statement }) => text.slice(statement.getFullStart(), statement.getEnd()))
        .join("")
        .trimStart();
    const misplacedStatement = entries[firstMisplaced]?.statement;
    return {
        file,
        firstMisplacedLine: misplacedStatement
            ? sourceFile.getLineAndCharacterOfPosition(misplacedStatement.getStart()).line + 1
            : 1,
        blockedBy: orderViolationOf(ordered, names),
        ordered: joined.endsWith("\n") ? joined : `${joined}\n`,
    };
};

export class SourceOrderChecker extends PipelineCommand {
    readonly usage = "[--fix]";
    readonly summary =
        "check that every src file keeps imports, constants, types, classes, helpers, registries in order; --fix reorders them (run npm run format after)";

    async run(args: readonly string[]): Promise<void> {
        const shouldFix = args.includes("--fix");
        const reports = listFilesRecursively(SOURCE_ROOT)
            .filter(
                (file) => SOURCE_FILE_PATTERN.test(file) && !DECLARATION_FILE_PATTERN.test(file)
            )
            .sort()
            .flatMap((file) => reportOf(file) ?? []);

        for (const report of reports) {
            const note = report.blockedBy ? ` (cannot reorder: ${report.blockedBy})` : "";
            console.log(`${report.file}:${report.firstMisplacedLine} out of order${note}`);
            if (shouldFix && !report.blockedBy) fs.writeFileSync(report.file, report.ordered);
        }

        const unresolved = shouldFix ? reports.filter((report) => report.blockedBy) : reports;
        if (unresolved.length > 0)
            throw new Error(`${unresolved.length} file(s) break the file order`);
        console.log(
            shouldFix ? `reordered ${reports.length} file(s)` : "all files keep the file order"
        );
    }
}
