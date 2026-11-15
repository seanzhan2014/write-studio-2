import {readFile} from "node:fs/promises";
import ts from "typescript";
const filename="dist/server/index.js";
const tree=ts.createSourceFile(filename,await readFile(filename,"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const definitions=new Map();let exported;
for(const statement of tree.statements){
 if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations)if(ts.isIdentifier(declaration.name)&&declaration.initializer)definitions.set(declaration.name.text,declaration.initializer);
 if(ts.isExportAssignment(statement))exported=statement.expression;
 if(ts.isExportDeclaration(statement)&&statement.exportClause&&ts.isNamedExports(statement.exportClause))for(const item of statement.exportClause.elements)if(item.name.text==="default")exported=item.propertyName??item.name;
}
const visited=new Set();while(exported&&ts.isIdentifier(exported)&&!visited.has(exported.text)){visited.add(exported.text);exported=definitions.get(exported.text);}
const valid=exported&&ts.isObjectLiteralExpression(exported)&&exported.properties.some(property=>property.name?.getText(tree)==="fetch"&&(ts.isMethodDeclaration(property)||ts.isPropertyAssignment(property)&&(ts.isArrowFunction(property.initializer)||ts.isFunctionExpression(property.initializer))));
if(!valid)throw new Error("Site build must default-export a Worker object with a callable fetch handler. Use WRITER_STUDIO_BUILD_TARGET=sites.");
console.log("Verified Site Worker default fetch handler.");
