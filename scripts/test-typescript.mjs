// Test-only loader: run the application's TypeScript modules with Node's test runner.
import {registerHooks} from 'node:module';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    let target;
    if (specifier.startsWith('@/')) target = new URL(specifier.slice(2), root);
    else if (specifier.startsWith('.') && context.parentURL) target = new URL(specifier, context.parentURL);
    if (target && !/\.(mjs|js|json|ts|tsx)$/.test(target.pathname)) {
      for (const extension of ['.ts', '.tsx']) if (existsSync(fileURLToPath(target) + extension)) return next(target.href + extension, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (/\.tsx?$/.test(url) && !url.includes('/node_modules/')) {
      return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'), {
        compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:fileURLToPath(url),
      }).outputText};
    }
    return next(url, context);
  },
});
