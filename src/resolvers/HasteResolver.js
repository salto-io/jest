/**
 * Copyright (c) 2014, Facebook, Inc. All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

/* eslint-disable fb-www/object-create-only-one-param */

'use strict';

const Cache = require('node-haste/lib/Cache');
const DependencyGraph = require('node-haste');
const FileWatcher = require('node-haste/lib/FileWatcher');

const extractRequires = require('node-haste/lib/lib/extractRequires');

const REQUIRE_EXTENSIONS_PATTERN = /(\b(?:require\s*?\.\s*?(?:requireActual|requireMock)|jest\s*?\.\s*?genMockFromModule)\s*?\(\s*?)(['"])([^'"]+)(\2\s*?\))/g;

class HasteResolver {

  constructor(config) {
    const extensions = config.moduleFileExtensions
      .concat(config.testFileExtensions);
    const ignoreFilePattern = new RegExp(
      [config.cacheDirectory].concat(config.modulePathIgnorePatterns).join('|')
    );

    this._defaultPlatform = config.haste.defaultPlatform;
    this._resolvePromises = Object.create(null);

    this._cache = new Cache({
      cacheDirectory: config.cacheDirectory,
      cacheKey: [
        'jest',
        config.name,
        config.rootDir,
        ignoreFilePattern.toString(),
      ].concat(extensions).join('$'),
    });

    this._fileWatcher = new FileWatcher([{
      dir: config.rootDir,
    }]);

    this._depGraph = new DependencyGraph(Object.assign({}, config.haste, {
      roots: [config.rootDir],
      ignoreFilePath: path => path.match(ignoreFilePattern),
      cache: this._cache,
      fileWatcher: this._fileWatcher,
      extensions,
      mocksPattern: new RegExp(config.mocksPattern),
      extractRequires: code => {
        const data = extractRequires(code);
        data.code = data.code.replace(
          REQUIRE_EXTENSIONS_PATTERN,
          (match, pre, quot, dep, post) => {
            data.deps.sync.push(dep);
            return match;
          }
        );
        return data;
      },
      shouldThrowOnUnresolvedErrors: () => false,
    }));

    // warm-up
    this._depGraph.load();
  }

  matchFilesByPattern(pattern) {
    return this._depGraph.matchFilesByPattern(pattern);
  }

  end() {
    return Promise.all([
      this._fileWatcher.end(),
      this._cache.end(),
    ]);
  }

  getDependencies(path) {
    if (this._resolvePromises[path]) {
      return this._resolvePromises[path];
    }

    return this._resolvePromises[path] = this._depGraph.load().then(
      () => this._depGraph.getDependencies(
        path,
        this._defaultPlatform
      ).then(response =>
        response.finalize().then(() => {
          var deps = {
            mocks: response.mocks,
            resolvedModules: Object.create(null),
            resources: Object.create(null),
          };
          return Promise.all(
            response.dependencies.map(module => {
              if (!deps.resolvedModules[module.path]) {
                deps.resolvedModules[module.path] = Object.create(null);
              }
              response.getResolvedDependencyPairs(module).forEach((pair) =>
                deps.resolvedModules[module.path][pair[0]] = pair[1]
              );
              return module.getName().then(
                name => deps.resources[name] = module
              );
            })
          ).then(() => deps);
        })
      ));
  }

}

module.exports = HasteResolver;
