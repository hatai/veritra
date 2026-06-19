# Veritra

Test-design web app.

## Toolchain Notes

- **Vite+** (`vite-plus@0.2.1`): The local CLI binary is `vp` (not `vite-plus`). All root scripts (`test`, `test:run`, `lint`, `format`) invoke `vp` accordingly.
- **TypeScript**: The brief targeted `7.0.0-beta` (Go-based rewrite RC). `vite-plus@0.2.1` peer-requires `^5.0.0 || ^6.0.0`, so TypeScript **6.0.3** (latest stable) is used instead. This satisfies all toolchain constraints without peer-dep warnings.
- **vitest**: Bundled inside `vite-plus@0.2.1` (v4.1.9). No separate `vitest` direct dep required — `vp test` resolves it via vite-plus's own dependencies.
