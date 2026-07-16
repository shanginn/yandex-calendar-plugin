# Yandex Calendar для Codex

[![CI](https://github.com/shanginn/yandex-calendar-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/shanginn/yandex-calendar-plugin/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Неофициальный локальный MCP-плагин для работы с Яндекс Календарём из Codex. Он обращается к `caldav.yandex.ru` напрямую: промежуточного сервера разработчика нет.

Автор: **Nikolai Shangin** — <shanginn@gmail.com>.

## Возможности MVP 0.1

- получить список календарей;
- прочитать события за указанный период до 366 дней;
- создать одиночное событие, при необходимости со ссылкой на Яндекс Телемост;
- изменить название, время, описание и место события;
- удалить событие только после явного подтверждения;
- обнаружить конфликт по ETag и не затереть более свежую версию события.

Не входят в первый MVP: редактирование правил повторения, ответы на приглашения, массовые операции, общий облачный сервис и OAuth для произвольных личных аккаунтов. Границы и критерии готовности описаны в [документе MVP](docs/mvp.md).

## Требования

- Node.js 20 или новее;
- аккаунт Яндекса с Календарём;
- отдельный **пароль приложения** типа «Календарь». Не используйте основной пароль аккаунта.

Инструкция Яндекса: [синхронизация по CalDAV и создание пароля приложения](https://yandex.ru/support/yandex-360/business/calendar/ru/data-exchange/synchronization/sync-desktop).

## Установка из публичного marketplace

```bash
codex plugin marketplace add shanginn/yandex-calendar-plugin
codex plugin add yandex-calendar@yandex-calendar
```

Рекомендуемый способ для Codex Desktop — приватный файл учётных данных:

```bash
mkdir -p ~/.config/yandex-calendar-plugin
printf '%s\n' '{"username":"you@yandex.ru","appPassword":"пароль-приложения"}' \
  > ~/.config/yandex-calendar-plugin/credentials.json
chmod 600 ~/.config/yandex-calendar-plugin/credentials.json
```

Плагин читает этот файл напрямую, поэтому настройка сохраняется после перезапуска приложения и компьютера. Другой путь можно указать через `YANDEX_CALENDAR_CREDENTIALS_FILE`.

Для запуска из терминала по-прежнему можно использовать переменные окружения:

```bash
export YANDEX_CALENDAR_USERNAME="you@yandex.ru"
export YANDEX_CALENDAR_APP_PASSWORD="пароль-приложения"
codex
```

После установки откройте новую задачу Codex и попросите, например: «Покажи мои встречи на сегодня».

## Локальная разработка

```bash
npm install
npm run check
codex plugin marketplace add "$PWD"
codex plugin add yandex-calendar@yandex-calendar
```

Сборка создаёт автономный `plugins/yandex-calendar/dist/server.mjs`, поэтому пользователю не нужно устанавливать npm-зависимости внутри плагина.

## Безопасность

- Секреты не принимаются в аргументах MCP-инструментов и не попадают в результаты.
- Приватный файл учётных данных должен иметь права `0600`; иначе плагин откажется его читать.
- CalDAV URL инструментов ограничены тем же origin, который задан конфигурацией.
- Внешний HTTP запрещён; незашифрованный localhost разрешён только тестам отдельным флагом.
- Удаление требует `confirm=true` и помечено `destructiveHint: true`.
- Для PUT используются ETag/`If-Match`, когда сервер их предоставляет.

Уязвимости сообщайте приватно по адресу <shanginn@gmail.com>. Подробнее: [SECURITY.md](SECURITY.md).

## Публикация в ChatGPT/Codex Directory

Репозиторий уже является устанавливаемым публичным Codex marketplace. Универсальный каталог ChatGPT/Codex принимает MCP-плагины через проверку OpenAI и требует публичный HTTPS MCP-сервер, OAuth, проверенную личность издателя и тестовые данные. Локальный MVP специально не передаёт пароль приложения стороннему серверу; план безопасной облачной версии описан в [документе публикации](docs/marketplace-submission.md).

## Лицензия и указание автора

Проект распространяется по **Apache License 2.0** и содержит файл [NOTICE](NOTICE). При распространении исходников, бинарных сборок или форков необходимо сохранить лицензию, copyright и атрибуцию автора из NOTICE. Требование действует согласно разделу 4 лицензии; оно не означает обязательный рекламный баннер при частном использовании.

Copyright 2026 Nikolai Shangin <shanginn@gmail.com>.

## Товарные знаки

Yandex является товарным знаком соответствующего правообладателя. Проект независимый, не является официальным продуктом и не аффилирован с Yandex или OpenAI.
