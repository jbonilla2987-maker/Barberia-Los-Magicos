# Barbería Los Mágicos

Sistema web premium para administración de barbería.

## Módulos

- Administrador
- Barberos con usuario propio
- Cobros y comisión
- Puestos configurables
- Servicios
- Citas de clientes
- Reportes
- Firebase Authentication
- Cloud Firestore
- Firebase Hosting
- GitHub Actions

## Firebase

Proyecto ya configurado:

`barberialosmagicos`

La configuración web real se encuentra en:

`public/firebase-config.js`

## Hosting

Publicación manual:

```bash
firebase login
firebase use barberialosmagicos
firebase deploy --only hosting
```

## GitHub

El repositorio incluye:

`.github/workflows/firebase-hosting.yml`

Para activar el despliegue automático, GitHub necesita el secret:

`FIREBASE_SERVICE_ACCOUNT_BARBERIALOSMAGICOS`

No guardes credenciales privadas dentro del repositorio.
