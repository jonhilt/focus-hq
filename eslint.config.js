// Correctness only (chiefly promise misuse that tsc can't see); no stylistic rules.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'data/'] },
  {
    files: ['shared/**/*.ts', 'server/**/*.ts', 'client/src/**/*.ts', 'plugins/**/*.ts', 'plugin-api/**/*.ts', 'vite.config.ts', 'vitest.config.ts', 'scripts/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      // Express's req.body is `any`; routes.ts already narrows each field at the boundary.
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      // tsc's noUnusedLocals/noUnusedParameters already enforce this, with its `_` prefix convention.
      '@typescript-eslint/no-unused-vars': 'off',
      // Demo fakes are async without awaiting to satisfy Promise-returning interfaces; making them sync changes throw-vs-reject.
      '@typescript-eslint/require-await': 'off',
      // String(unknown) is the deliberate coercion for untyped model output and three.js colour cache keys.
      '@typescript-eslint/no-base-to-string': 'off',
    },
  },
  {
    // A cast on Object.keys/entries/fromEntries claims a record's keys without checking them: keysOf and recordOf
    // (shared/records.ts) read and build such a record, tested.
    files: ['shared/**/*.ts', 'server/**/*.ts', 'client/src/**/*.ts', 'plugins/**/*.ts', 'plugin-api/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "TSAsExpression > CallExpression.expression[callee.object.name='Object'][callee.property.name=/^(keys|entries|fromEntries)$/]",
        message: 'Use keysOf or recordOf (shared/records.ts) instead of casting what Object.keys/entries/fromEntries return.',
      }, {
        // `(o as THREE.Mesh).isMesh` checks a cast it has already made: isMesh (client/src/world/isMesh.ts) checks and narrows at once.
        selector: "TSAsExpression > TSTypeReference.typeAnnotation[typeName.left.name='THREE'][typeName.right.name=/^(Mesh|SkinnedMesh|InstancedMesh)$/]",
        message: 'Narrow an Object3D with isMesh (client/src/world/isMesh.ts), or `instanceof` for a SkinnedMesh or InstancedMesh, instead of casting it.',
      }, {
        // `(LIST as readonly string[]).includes(v)` or `LIST.includes(v as T)` casts to check a membership it then has
        // to cast again: isOneOf (shared/records.ts) checks and narrows at once.
        selector: "MemberExpression[property.name=/^(includes|has)$/] > TSAsExpression.object",
        message: 'Check that a value is one of a list with isOneOf (shared/records.ts) instead of casting the list.',
      }, {
        selector: "CallExpression[callee.property.name=/^(includes|has)$/] > TSAsExpression.arguments",
        message: 'Check that a value is one of a list with isOneOf (shared/records.ts) instead of casting the value.',
      }],
    },
  },
  {
    // A wrong `x!` in the office's server is a crash mid-run; say what's missing instead (tests may still assert).
    files: ['shared/**/*.ts', 'server/**/*.ts', 'plugins/**/*.ts', 'plugin-api/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
);
