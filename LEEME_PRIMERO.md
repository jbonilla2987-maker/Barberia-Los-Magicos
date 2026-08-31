# BARBERÍA LOS MÁGICOS — REPOSITORIO LISTO PARA GITHUB

Este paquete ya tiene configurado:

- Firebase Project ID: `barberialosmagicos`
- Firebase Web App
- Firebase Authentication
- Cloud Firestore
- Firebase Hosting
- Reglas Firestore
- 4 puestos iniciales al entrar como administrador
- Servicios iniciales
- Portal administrador
- Portal barbero
- Portal de citas para clientes
- GitHub Actions para despliegue automático a Firebase Hosting

## SUBIR A GITHUB

Puedes crear un repositorio nuevo y subir TODO el contenido de esta carpeta a la raíz.

La rama de producción debe llamarse:

`main`

## ÚNICO PASO DE SEGURIDAD QUE NO PUEDE IR DENTRO DEL ZIP

GitHub necesita una credencial secreta de Firebase para realizar el despliegue automático.

No debes subir una cuenta de servicio al repositorio.

Después de crear el repositorio puedes configurar la integración oficial desde tu PC:

```bash
firebase login
firebase use barberialosmagicos
firebase init hosting:github
```

O agregar manualmente el GitHub Secret esperado por el workflow:

`FIREBASE_SERVICE_ACCOUNT_BARBERIALOSMAGICOS`

## PUBLICACIÓN MANUAL

Aunque todavía no configures GitHub Actions, este mismo repositorio se puede publicar desde una PC con:

```bash
firebase login
firebase use barberialosmagicos
firebase deploy --only hosting
```

## IMPORTANTE

`public/firebase-config.js` YA contiene la configuración real del proyecto Firebase.
No necesitas reemplazar ningún valor.
