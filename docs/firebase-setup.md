# Prender la sincronización (Firebase)

La sync está **apagada** hasta que conectes un proyecto de Firebase. Sin esto,
las apps funcionan igual, offline, en tu dispositivo — la sync es opcional.

Las **dos apps** (Booth Mode y Forge Log) se conectan al **mismo proyecto** y
entras con la **misma cuenta** en ambas. Así una venta en Booth y el catálogo de
Forge Log viven en el mismo lugar. Cada cuenta ve solo sus propios datos.

Es gratis (plan Spark de Firebase) y toma ~10 minutos, una sola vez.

## 1. Crea el proyecto

1. Entra a <https://console.firebase.google.com> con tu cuenta de Google.
2. **Add project** → ponle nombre (ej. `entropy-suite`) → puedes desactivar
   Google Analytics → **Create project**.

## 2. Activa el inicio de sesión

1. En el menú izquierdo: **Build → Authentication → Get started**.
2. Pestaña **Sign-in method** → habilita **Email/Password** → **Save**.
3. (Opcional) habilita **Google** también, si quieres el botón "Continuar con
   Google".

## 3. Crea la base de datos

1. **Build → Firestore Database → Create database**.
2. Elige **Production mode** (las reglas de abajo la protegen) → una ubicación
   cercana (ej. `us-central` o `nam5`) → **Enable**.

## 4. Pon las reglas de seguridad

En **Firestore Database → Rules**, reemplaza todo por esto y **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Cada cuenta solo puede leer y escribir bajo su propio uid.
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

Esto es importante: sin ellas, cualquiera podría leer tus datos. Con ellas, solo
tú (con tu cuenta) tocas lo tuyo.

## 5. Copia la config

1. Ícono de engrane (**Project settings**) → baja a **Your apps**.
2. Clic en el ícono **`</>`** (Web) → ponle un apodo (ej. `suite`) → **Register
   app**. No necesitas Hosting.
3. Te muestra un bloque `const firebaseConfig = { ... }`. Copia **solo el objeto
   `{ ... }`** (desde la `{` hasta la `}`).

Se ve así:

```js
const firebaseConfig = {
  apiKey: "AIza…",
  authDomain: "entropy-suite.firebaseapp.com",
  projectId: "entropy-suite",
  storageBucket: "entropy-suite.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234:web:abcd…"
};
```

## 6. Pégala en las apps

En **cada** app (Booth Mode y Forge Log):

1. Toca el chip **⟳** arriba a la derecha → se abre *Sincronizar*.
2. Pega el objeto de config → **Guardar config**.
3. **Crear cuenta** con un correo y contraseña (la primera vez), o **Entrar** si
   ya la creaste en la otra app. Usa **la misma cuenta en las dos**.
4. **Sincronizar ahora**.

Listo. A partir de aquí, en cualquiera de las dos: **Sincronizar ahora** sube tus
cambios y baja los de la otra. Costea un producto en Forge Log, sincroniza; abre
Booth Mode, sincroniza, y ese costo (y su utilidad) ya está ahí.

## Notas

- **Sin red no pasa nada malo.** Las apps siguen funcionando; sincronizas cuando
  vuelva el internet. El motor de sync une los cambios de ambos lados sin
  perder nada — el registro de ventas es append-only y a prueba de conflictos.
- **Conflictos de edición** (editaste el mismo producto en dos lados sin
  sincronizar): gana el más reciente. Los dos dispositivos llegan a la misma
  respuesta.
- **Borrar** un producto/tier/receta se propaga (no "revive" desde el otro
  dispositivo).
- Aún **no** hay sincronización automática en segundo plano ni push de alertas
  de resurtido — eso viene después. Por ahora la sync es con el botón.
- **Fotos**: los ajustes de Forge Log guardan la foto de resultado localmente;
  subirla a Firebase Storage es un paso siguiente (no incluido todavía).
