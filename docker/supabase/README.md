# Supabase self-hosted (Docker) — Rent Finder

Este diretório instala o **Supabase oficial self-hosted** no mesmo servidor onde corre a aplicação. Os dados ficam em **volumes no disco** (`project/volumes/db/data`) e **sobrevivem a reinícios** do Docker e do sistema operativo.

> **Importante:** não execute `reset.sh` na pasta `project/` em produção — esse comando apaga a base de dados.

## Pré-requisitos no servidor

- Linux (Debian/Ubuntu recomendado)
- Docker Engine + plugin Compose
- Git
- Mínimo: 4 GB RAM, 2 vCPU, 40 GB disco (recomendado 8 GB+ RAM)

## Instalação rápida

```bash
cd docker/supabase
chmod +x setup.sh manage.sh backup.sh
./setup.sh
```

Por defeito instala em `docker/supabase/project/`. Para um caminho fixo no servidor (recomendado em produção):

```bash
sudo mkdir -p /opt/rent-finder
./setup.sh --dir /opt/rent-finder/supabase
export SUPABASE_INSTALL_DIR=/opt/rent-finder/supabase   # para manage.sh / backup.sh
```

No fim, o script gera `docker/supabase/.env.generated` com o `DATABASE_URL`.

## Ligar a aplicação

```bash
# Na raiz do monorepo
cp docker/supabase/.env.generated rent_finder_front/.env.local

# Aplicar migrações SQL do projeto
npm run db:migrate

# Arrancar o front (ou o seu processo de deploy)
npm run dev
```

### Formato do `DATABASE_URL`

O Rent Finder usa apenas Postgres (Drizzle + `postgres.js`), não o client JS do Supabase. A connection string recomendada é o **pooler em modo transaction** (porta **6543**):

```
postgresql://postgres.rentfinder:[POSTGRES_PASSWORD]@127.0.0.1:6543/postgres
```

O código já define `prepare: false`, compatível com este pooler.

Se a app correr **no mesmo servidor** que o Docker, use `127.0.0.1`. Se a app estiver noutro host (ex.: Vercel), exponha a porta 6543 com firewall restrito — não é o cenário recomendado.

## Comandos úteis

```bash
./manage.sh status      # estado dos containers
./manage.sh start       # iniciar
./manage.sh stop        # parar (dados mantêm-se)
./manage.sh logs db     # logs do Postgres
./manage.sh secrets     # credenciais do .env
./manage.sh url         # imprimir DATABASE_URL
./manage.sh backup      # pg_dump comprimido em backups/
```

## Persistência dos dados

| Ação | Dados mantidos? |
|------|-----------------|
| `manage.sh stop` / `start` | Sim |
| Reboot do servidor | Sim (com `restart: unless-stopped`) |
| `docker compose restart` | Sim |
| Apagar pasta `project/volumes/db/data` | **Não** |
| `project/reset.sh` | **Não** |

Os ficheiros físicos ficam em `project/volumes/db/data`. Para redundância, agende backups:

```bash
# crontab -e
0 3 * * * /caminho/para/rent_finder/docker/supabase/backup.sh
```

## Studio (dashboard)

- URL: `http://127.0.0.1:8000` (ou IP do servidor)
- Utilizador/password: ver `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` em `project/.env` ou `./manage.sh secrets`

## Atualizar o Supabase

Consulte a [documentação oficial](https://supabase.com/docs/guides/self-hosting/updating). Na pasta `project/`:

```bash
sh update.sh
```

## Arranque automático após reboot

Copie e adapte `rent-finder-supabase.service` para `/etc/systemd/system/`, ajustando `WorkingDirectory` para o caminho da instalação (ex.: `/opt/rent-finder/supabase`):

```bash
sudo cp rent-finder-supabase.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rent-finder-supabase
```

## Estrutura

```
docker/supabase/
├── setup.sh                      # instalação inicial
├── manage.sh                     # start/stop/backup
├── backup.sh                     # pg_dump
├── docker-compose.override.yml   # restart + persistência
├── project/                      # instalação gerada (gitignored)
│   ├── docker-compose.yml
│   ├── .env                      # segredos — não commitar
│   └── volumes/db/data/          # dados Postgres
└── backups/                      # dumps opcionais
```
