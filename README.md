# Education notifier runtime

An hourly official-source collector and Telegram notifier. Configuration, recipient information, delivery history and request suspensions are stored in an AES-256-GCM encrypted snapshot. Existing Telegram credentials are injected through repository Secrets. No applications are submitted.

Only the hourly schedule and manual dispatch can run this workflow. State is persisted before each message is sent. Unknown delivery results are held for manual recovery. Standard Ubuntu runners are used without Actions caches or artifacts.
