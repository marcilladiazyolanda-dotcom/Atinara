# Paso 11C · Protección gratuita de contraseñas

## Objetivo

Impedir desde el registro normal de Oraklo que se usen contraseñas débiles o presentes en filtraciones conocidas, sin contratar Supabase Pro y sin enviar la contraseña completa a un tercero.

Este paso no modifica tablas, RLS, RPC, perfiles ni cuentas existentes. No requiere ejecutar SQL.

## Qué aplica el frontend

- Doce caracteres como mínimo.
- Al menos una letra minúscula.
- Al menos una letra mayúscula.
- Al menos un número.
- Al menos un símbolo admitido por Supabase.
- Consulta de Pwned Passwords únicamente al enviar el formulario de alta.
- Cálculo SHA-1 dentro del navegador.
- Envío exclusivo de los primeros cinco caracteres del hash mediante k-anonimato.
- Cabecera `Add-Padding: true`, sin cookies, credenciales, referente ni cuerpo.
- Bloqueo del alta si la contraseña aparece en filtraciones.
- Bloqueo temporal del alta, con mensaje comprensible, si la comprobación no está disponible.
- El inicio de sesión de las cuentas existentes no realiza ninguna consulta a Pwned Passwords.

## Orden de activación

1. Descomprimir el ZIP completo del Paso 11C.
2. Subir todo su contenido a GitHub, conservando las carpetas.
3. Esperar a que GitHub Pages finalice el despliegue.
4. Recargar Oraklo con `Ctrl+F5`.
5. En Supabase, abrir **Authentication → Providers → Email**.
6. En los requisitos de contraseña, guardar:
   - Longitud mínima: `12`.
   - Caracteres requeridos: la opción más fuerte, con minúsculas, mayúsculas, números y símbolos.
7. Dejar desactivada la protección integrada de contraseñas filtradas si aparece bloqueada por el plan Pro. Oraklo ya realiza esa consulta en su formulario público.
8. No ejecutar ninguna migración ni SQL para este paso.

## Aceptación en la web pública

### Inicio de sesión

- [ ] Al abrir **Entrar**, la pestaña de inicio de sesión conserva el formulario normal.
- [ ] No aparece la lista de requisitos en el inicio de sesión.
- [ ] La cuenta existente puede entrar con su contraseña actual.

### Creación de cuenta

- [ ] Al pulsar **Crear cuenta**, aparece la lista de cinco requisitos.
- [ ] Los indicadores cambian de pendiente a cumplido mientras se escribe, sin realizar consultas de red.
- [ ] Una contraseña de menos de doce caracteres no permite continuar.
- [ ] La contraseña de prueba `Password123!` cumple el formato, pero queda bloqueada por aparecer en filtraciones conocidas.
- [ ] El aviso mostrado está en español y no crea una cuenta.
- [ ] Una contraseña nueva, única y no filtrada permite que Supabase continúe el registro normal.
- [ ] Mientras se comprueba la contraseña no se puede cambiar de pestaña ni enviar el formulario dos veces.

### Privacidad y fallos

- [ ] La petición de red va a `api.pwnedpasswords.com/range/` seguida de cinco caracteres hexadecimales.
- [ ] La petición no contiene la contraseña, el email, el username ni el hash completo.
- [ ] Si el servicio externo falla, se muestra un mensaje amable y no se llama a `signUp`.
- [ ] No aparecen errores propios de Oraklo en la consola.

## Limitación conocida

La comprobación de filtraciones se ejecuta en el frontend y protege el flujo normal de Oraklo. Una persona con conocimientos técnicos aún podría llamar directamente al endpoint público de Supabase Auth y saltarse esa comprobación concreta. La longitud y la combinación de caracteres configuradas en Supabase sí se aplican en el servidor.

La protección completa en el servidor exigiría la función Pro de Supabase o rediseñar el alta alrededor de un backend propio. Para el MVP gratuito, este control mejora de forma sustancial el registro sin introducir secretos ni una infraestructura nueva.

## Pruebas técnicas incluidas

Ejecutar desde la raíz del repositorio:

```bash
node --check password-security.js
node --check auth.js
node --test tests/password-security.test.js
git diff --check
```
