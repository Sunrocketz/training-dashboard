# Индекс документации

Единая карта знаний проекта. Если документ не описан здесь — его либо нет, либо он устарел.

## Старт

| Документ | Зачем |
|----------|-------|
| [../README.md](../README.md) | Обзор репозитория, стек, ссылки |
| [../.cursor/rules/00-project.mdc](../.cursor/rules/00-project.mdc) | Главные правила — тегать `@00-project.mdc` |
| [../AGENTS.md](../AGENTS.md) | Указатель → 00-project.mdc |
| [Architecture.md](Architecture.md) | Как устроена система end-to-end |
| [Modules.md](Modules.md) | Карта модулей и зон ответственности |

## Контракты и данные (защита от долга)

| Документ | Зачем |
|----------|-------|
| [ApiContract.md](ApiContract.md) | Форма JSON между GAS и UI — **источник истины** |
| [DataModel.md](DataModel.md) | Колонки листа, фильтры строк, формулы агрегации |
| [Decisions.md](Decisions.md) | ADR — почему так, а не иначе |
| [Conventions.md](Conventions.md) | Стиль кода, именование, git |
| [Security.md](Security.md) | Доступ, ПДн, публичный `/exec` |
| [Glossary.md](Glossary.md) | Термины домена |

## Операции и планирование

| Документ | Зачем |
|----------|-------|
| [Runbook.md](Runbook.md) | Деплой, clasp, откат, типовые поломки |
| [Roadmap.md](Roadmap.md) | Дорожная карта |
| [Ideas.md](Ideas.md) | Идеи и бэклог без обязательств |

## Cursor rules

| Файл | Область |
|------|---------|
| [../.cursor/rules/00-project.mdc](../.cursor/rules/00-project.mdc) | Всегда (главные правила) |
| [../.cursor/rules/frontend.mdc](../.cursor/rules/frontend.mdc) | `index.html` |
| [../.cursor/rules/apps-script.mdc](../.cursor/rules/apps-script.mdc) | `apps-script/**` |

## Как поддерживать docs

1. Меняешь поведение → обнови контракт / data model в том же PR/коммите.
2. Меняешь архитектуру → короткий ADR в Decisions.md.
3. Закрыл идею или этап → отметь в Ideas / Roadmap.
4. Раз в месяц: пройти Index и выкинуть устаревшее.
