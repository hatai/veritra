# Veritra

Test-design web app.

## Toolchain Notes

- **Vite+** (`vite-plus@0.2.1`): The local CLI binary is `vp` (not `vite-plus`). All root scripts (`test`, `test:run`, `lint`, `format`) invoke `vp` accordingly.
- **TypeScript**: The brief targeted `7.0.0-beta` (Go-based rewrite RC). `vite-plus@0.2.1` peer-requires `^5.0.0 || ^6.0.0`, so TypeScript **6.0.3** (latest stable) is used instead. This satisfies all toolchain constraints without peer-dep warnings.
- **vitest**: Bundled inside `vite-plus@0.2.1` (v4.1.9); also pinned as a direct root devDependency (`vitest@4.1.9`) so `tsconfig.base.json`'s `"types": ["vitest/globals"]` resolves without relying on transitive hoisting.
- **pnpm**: `packageManager` is set to `pnpm@10.32.1`. The brief specified `pnpm@9.15.0`, but pnpm 10 is the stable version present in the environment and is used throughout this repo.
