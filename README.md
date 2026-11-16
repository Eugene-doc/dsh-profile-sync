# DSH Profile Sync

Отдельный плагин DeepSeek Harness для синхронизации **только плагинов и глобальных
скиллов** между компьютерами через приватный GitHub-репозиторий.

Настройки, ключи, чаты, workspace и Chat Sync не синхронизируются.

## Что синхронизируется

- зависимости профиля `~/.dsh/profiles/<profile>/package.json`;
- список bundle-плагинов;
- локальные плагины `link:`/`file:` в виде `.tgz` с SHA-256;
- файлы `~/.dsh/skills/*.md`.

`node_modules` не копируется. Пакеты устанавливаются локально пакетным менеджером.

## Установка

```powershell
dsh plugin --profile desktop add "file:D:\path\to\dsh-profile-sync-0.1.2.tgz"
```

После установки перезапустите DSH и откройте **Настройки → Плагины и скиллы**.

## Первый запуск

1. Создайте **приватный** репозиторий `Eugene-doc/dsh-profile-data`.
2. Убедитесь, что `git` и `gh` авторизованы на этом ПК.
3. Нажмите **Синхронизировать** — будет создан снимок в
   `profiles/desktop/devices/<device-id>/`.
4. На втором ПК установите плагин, повторите синхронизацию.
5. Выберите снимок другого ПК и нажмите **Применить выбранный снимок**.

## Безопасность

- Репозиторий данных должен быть приватным: в нём лежат исходники локальных плагинов и
  текст скиллов.
- Применение всегда ручное.
- Перед изменением создаётся backup в `~/.dsh/profile-sync/backups/`.
- При ошибке установки файлы профиля и lockfile восстанавливаются.
- Плагины — это исполняемый код. Проверяйте источник перед применением.

## Ограничения MVP

- только профиль `desktop`;
- удаление плагинов и скиллов не выполняется;
- секреты и настройки не синхронизируются;
- для локального плагина нужен архив; без него применение блокируется;
- после применения перезапустите DSH вручную.

## English summary

A separate DSH plugin that syncs only profile plugins and global skills through a private
GitHub data repository. It snapshots package manifests, bundle lists, local plugin
archives and skill files. Applying is manual, backed up, and rolled back on failure.
Settings, credentials, chats and workspaces are deliberately excluded.
