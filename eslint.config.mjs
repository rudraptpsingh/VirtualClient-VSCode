import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [{
    files: ["**/*.ts"],
    plugins: {
        "@typescript-eslint": typescriptEslint,
    },
    languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: "module",
    },
    rules: {
        // Original rules
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],
        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
        quotes: ["warn", "single", { avoidEscape: true }],
        "prefer-const": "warn",
        "no-async-promise-executor": "error",
        "@typescript-eslint/no-floating-promises": "error",
        "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
        
        // Enhanced formatting and indentation rules
        "indent": ["error", 4, { "SwitchCase": 1 }],
        "no-trailing-spaces": "error",
        "eol-last": "error",
        "max-len": ["warn", { "code": 120, "ignoreUrls": true, "ignoreStrings": true }],
        
        // TypeScript specific enhancements
        "@typescript-eslint/no-explicit-any": "warn",
        "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
        
        // Code style improvements
        "object-curly-spacing": ["error", "always"],
        "array-bracket-spacing": ["error", "never"],
        "comma-dangle": ["error", "always-multiline"],
        "brace-style": ["error", "1tbs", { "allowSingleLine": true }],
        "keyword-spacing": "error",
        "space-before-blocks": "error",
        "space-infix-ops": "error",
        
        // Function and method formatting
        "space-before-function-paren": ["error", {
            "anonymous": "always",
            "named": "never",
            "asyncArrow": "always"
        }],
        
        // Consistency rules
        "no-multiple-empty-lines": ["error", { "max": 2, "maxEOF": 1 }],
        "padded-blocks": ["error", "never"],
    },
}];