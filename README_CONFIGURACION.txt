BARBERÍA LOS MÁGICOS — VERSIÓN CORREGIDA PARA GITHUB PAGES

ESTA VERSIÓN ESTÁ HECHA PARA SUBIR TODOS LOS ARCHIVOS DIRECTAMENTE A LA RAÍZ DEL REPOSITORIO.
NO HAY CARPETA public.

ARCHIVOS PRINCIPALES:
- index.html
- styles.css
- app.js
- firebase-config.js
- firestore.rules
- firestore.indexes.json
- README_CONFIGURACION.txt

IMPORTANTE: FIREBASE AUTHORIZED DOMAINS
--------------------------------------
Si la web está en GitHub Pages, Firebase Authentication puede bloquear el inicio de sesión
si tu dominio de GitHub no está autorizado.

En Firebase:
Authentication > Configuración > Dominios autorizados

Agrega:
TU_USUARIO.github.io

Ejemplo:
jbonilla2987-maker.github.io

Esto es OBLIGATORIO para que Administrador y Barberos puedan iniciar sesión desde GitHub Pages.


CONFIGURACIÓN DE AUTHENTICATION
-------------------------------
Firebase > Authentication > Método de acceso

Activa:
1. Correo electrónico/contraseña
2. Anónimo

No necesitas activar enlace sin contraseña.


PRIMER ADMINISTRADOR
--------------------
El primer administrador se crea UNA SOLA VEZ manualmente.

A) Firebase > Authentication > Usuarios > Agregar usuario
   - Correo: tu correo real
   - Contraseña: una contraseña que recuerdes

B) Copia el UID del usuario.

C) Firestore > Datos > colección "users"
   Crea un documento cuyo ID sea EXACTAMENTE el UID.

Campos:
active      boolean  true
emailAlias  string   TU_CORREO_REAL
name        string   Administrador
role        string   admin
username    string   admin

Después el administrador entra a la web con:
- Correo real
- Contraseña creada en Authentication


CREAR BARBEROS / USUARIOS
-------------------------
Después de entrar como Administrador:
Usuarios / Barberos > Crear usuario

Campos:
- Nombre
- Usuario
- Contraseña
- Confirmar contraseña
- Comisión (50% por defecto)

La aplicación crea automáticamente:
1. La cuenta Firebase Authentication del barbero.
2. Su perfil en Firestore.
3. Su registro público para el módulo de citas.

El barbero entra con:
- Usuario
- Contraseña

La contraseña NO se guarda en Firestore ni se muestra después.
Firebase Authentication la protege.


FIRESTORE RULES
---------------
Copia TODO el contenido de firestore.rules y publícalo en:
Firebase > Firestore > Reglas


GITHUB PAGES
------------
1. Borra los archivos anteriores del repositorio.
2. Sube TODOS los archivos de este paquete a la raíz.
3. Settings > Pages
4. Source: Deploy from a branch
5. Branch: main
6. Folder: /(root)
7. Save

La URL será:
https://TU_USUARIO.github.io/NOMBRE_REPOSITORIO/


PRUEBA RECOMENDADA
------------------
1. Entra como Administrador.
2. Confirma que abre Dashboard.
3. Crea un barbero con usuario y contraseña.
4. Cierra sesión.
5. Entra como Barbero con esas credenciales.
6. Cierra sesión.
7. Entra como Cliente y crea una cita.
8. Vuelve al Administrador y confirma que aparece.
