// @flow

import * as helpers from "@babel/helpers";
import { NodePath, Hub, Scope } from "@babel/traverse";
import { codeFrameColumns } from "@babel/code-frame";
import traverse from "@babel/traverse";
import * as t from "@babel/types";

import type { NormalizedFile } from "../normalize-file";

const errorVisitor = {
  enter(path, state) {
    const loc = path.node.loc;
    if (loc) {
      state.loc = loc;
      path.stop();
    }
  },
};

export default class File {
  _map: Map<any, any> = new Map();
  opts: Object;
  declarations: Object = {};
  path: NodePath = null;
  ast: Object = {};
  scope: Scope;
  metadata: {} = {};
  hub: Hub = new Hub(this);
  code: string = "";
  shebang: string | null = "";
  inputMap: Object | null = null;

  constructor(options: {}, { code, ast, shebang, inputMap }: NormalizedFile) {
    this.opts = options;
    this.code = code;
    this.ast = ast;
    this.shebang = shebang;
    this.inputMap = inputMap;

    this.path = NodePath.get({
      hub: this.hub,
      parentPath: null,
      parent: this.ast,
      container: this.ast,
      key: "program",
    }).setContext();
    this.scope = this.path.scope;
  }

  set(key: mixed, val: mixed) {
    this._map.set(key, val);
  }

  get(key: mixed): any {
    return this._map.get(key);
  }

  has(key: mixed): boolean {
    return this._map.has(key);
  }

  getModuleName(): ?string {
    const opts = this.opts;
    if (!opts.moduleIds) {
      return null;
    }

    // moduleId is n/a if a `getModuleId()` is provided
    if (opts.moduleId != null && !opts.getModuleId) {
      return opts.moduleId;
    }

    let filenameRelative = opts.filenameRelative;
    let moduleName = "";

    if (opts.moduleRoot != null) {
      moduleName = opts.moduleRoot + "/";
    }

    if (!opts.filenameRelative) {
      return moduleName + opts.filename.replace(/^\//, "");
    }

    if (opts.sourceRoot != null) {
      // remove sourceRoot from filename
      const sourceRootRegEx = new RegExp("^" + opts.sourceRoot + "/?");
      filenameRelative = filenameRelative.replace(sourceRootRegEx, "");
    }

    // remove extension
    filenameRelative = filenameRelative.replace(/\.(\w*?)$/, "");

    moduleName += filenameRelative;

    // normalize path separators
    moduleName = moduleName.replace(/\\/g, "/");

    if (opts.getModuleId) {
      // If return is falsy, assume they want us to use our generated default name
      return opts.getModuleId(moduleName) || moduleName;
    } else {
      return moduleName;
    }
  }

  // TODO: Remove this before 7.x's official release. Leaving it in for now to
  // prevent unnecessary breakage between beta versions.
  resolveModuleSource(source: string): string {
    return source;
  }

  addImport() {
    throw new Error(
      "This API has been removed. If you're looking for this " +
        "functionality in Babel 7, you should import the " +
        "'@babel/helper-module-imports' module and use the functions exposed " +
        " from that module, such as 'addNamed' or 'addDefault'.",
    );
  }

  addHelper(name: string): Object {
    const declar = this.declarations[name];
    if (declar) return declar;

    const generator = this.get("helperGenerator");
    const runtime = this.get("helpersNamespace");
    if (generator) {
      const res = generator(name);
      if (res) return res;
    } else if (runtime) {
      return t.memberExpression(runtime, t.identifier(name));
    }

    const uid = (this.declarations[name] = this.scope.generateUidIdentifier(
      name,
    ));

    const dependencies = {};
    for (const dep of helpers.getDependencies(name)) {
      dependencies[dep] = this.addHelper(dep);
    }

    const { nodes, globals } = helpers.get(
      name,
      dep => dependencies[dep],
      uid,
      Object.keys(this.scope.getAllBindings()),
    );

    globals.forEach(name => {
      if (this.path.scope.hasBinding(name, true /* noGlobals */)) {
        this.path.scope.rename(name);
      }
    });

    nodes.forEach(node => {
      node._compact = true;
    });

    this.path.unshiftContainer("body", nodes);
    // TODO: NodePath#unshiftContainer should automatically register new
    // bindings.
    this.path.get("body").forEach(path => {
      if (nodes.indexOf(path.node) === -1) return;
      if (path.isVariableDeclaration()) this.scope.registerDeclaration(path);
    });

    return uid;
  }

  addTemplateObject() {
    throw new Error(
      "This function has been moved into the template literal transform itself.",
    );
  }

  buildCodeFrameError(
    node: ?{
      loc?: { line: number, column: number },
      _loc?: { line: number, column: number },
    },
    msg: string,
    Error: typeof Error = SyntaxError,
  ): Error {
    let loc = node && (node.loc || node._loc);

    msg = `${this.opts.filename}: ${msg}`;

    if (!loc && node) {
      const state = {
        loc: null,
      };
      traverse(node, errorVisitor, this.scope, state);
      loc = state.loc;

      let txt =
        "This is an error on an internal node. Probably an internal error.";
      if (loc) txt += " Location has been estimated.";

      msg += ` (${txt})`;
    }

    if (loc) {
      msg +=
        "\n" +
        codeFrameColumns(
          this.code,
          {
            start: {
              line: loc.line,
              column: loc.column + 1,
            },
          },
          this.opts,
        );
    }

    return new Error(msg);
  }
}
