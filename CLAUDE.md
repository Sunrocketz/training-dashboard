# CLAUDE.md

Правила проекта живут в `.cursor/rules/` — единый источник для Cursor и Claude Code. Здесь они импортируются целиком, не дублировать их в этот файл.

В Claude Code тегать `@00-project.mdc` не нужно: правила ниже загружаются в каждую сессию автоматически. Перед задачей — сверяться с `docs/Index.md`.

## Главные правила (всегда)

@.cursor/rules/00-project.mdc

## Apps Script — при работе с `apps-script/**`

@.cursor/rules/apps-script.mdc

## Frontend — при работе с `index.html`

@.cursor/rules/frontend.mdc

## Особенности Claude Code

- `.claude/settings.json` требует подтверждения на `git commit`, `git push`, `clasp push`, `clasp deploy` / `undeploy`, `netlify deploy` — это техническая страховка правила «только с явного согласия», не замена ему.
- Новое правило добавлять в `.cursor/rules/*.mdc` (и при новом файле — импорт сюда + строку в `docs/Index.md`).
