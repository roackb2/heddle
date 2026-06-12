# web-v2 Notifications

This hook folder owns browser delivery for notification intents projected by
`src/client-shared/services/notifications`.

## Boundary

- Client-shared decides which session or heartbeat events deserve
  notification.
- web-v2 decides whether to use the browser Notification API, keeps an in-app
  toast as local feedback, and marks the browser tab title while the page is
  backgrounded.
- Browser permission is per browser profile and must be requested from a user
  gesture in General settings.

Do not create a separate event subscription or duplicate approval/task policy in
this folder. Consume the existing control-plane session and heartbeat event
streams, then pass projected intents to the delivery hook.

## Current Scope

Notifications are delivered while the web control plane is open. This is not a
Web Push implementation and does not notify after the browser app is closed.
