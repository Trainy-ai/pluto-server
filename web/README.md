```bash
cp app/.env.example app/.env.local
cp server/.env.example server/.env.local
pnpm -i
set -a; source app/.env.local; source server/.env.local; turbo run build
```
