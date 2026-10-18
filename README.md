# Buscador AFINAZONE

Herramienta web para que el equipo de ventas consulte, desde el navegador, las publicaciones del RECETARIO (Omova HUB). Permite buscar de tres formas:

1. **Por número de publicación:** muestra el canal, el producto, el vehículo y los números de parte.
2. **Por vehículo:** usa filtros independientes y combinables.
3. **Por número de parte:** muestra todas las publicaciones que llevan esa pieza y se puede limitar por vehículo.

---

## 1. Diagnóstico de la hoja (analizado el 17-oct-2026, 1,111 registros)

| Columnas | Contenido real | Notas |
|---|---|---|
| Fila 1 | Números de columna (1, 2, 3…) | **No son encabezados.** Los encabezados están en la **fila 2** y los datos empiezan en la 3. |
| A `ID_Omova` | Fórmula que arma el ID con la pestaña `HUB-Listas` | En el archivo exportado sale "Marca no listada", porque esa pestaña no venía. |
| B `Entidad_Fiscal` | RFC | No se envía al buscador. |
| C `#_Publicación_ML` | Número de publicación de ML (canal principal) | 64 filas traen un **código interno** (ej. `KATSTENS8-XTRAIL`, todas de X-Trail) en lugar del número de ML, y 1 fila (56) trae un espacio invisible. |
| E `#_ASIN_AMZ` | ASIN de Amazon | Solo 3 capturados. |
| G, I, K | UPC Web AFZ, URL Web OCF, Ref. directo | Vacías hoy. El buscador ya las lee cuando se capturen. |
| D, F, H, J `Completa` | Casilla por canal | Se muestra "✓ completa" cuando está marcada. |
| L `Descripción` | Título de la publicación | |
| M–X | Compatibilidad: Transmisión, Clasificación, Marca, Modelo, Año_Inicio, Año_Final, Final_Producción, Motor_Litros, Cilindros, Conf_Motor, Marca_Aceite, Especificación_Aceite | Cilindros y Conf_Motor están vacías. **Cada fila tiene un solo vehículo.** |
| Y `Precio_lista` | Precio | **No es compatibilidad.** |
| Z `RECETA` | Fórmula que junta "código, cantidad" de AA:DB | **Omite las piezas sin cantidad** (fila 648: faltan OMF-002 y OMF-006). |
| AA–DB | 40 pares `Familia` / `Cant._N` | Una celda puede tener varios códigos separados por coma (`OMF-001,OMF-003`). La cantidad puede ser una sola para todos o una lista paralela (`7,5` en la fila 112). La columna CO no tiene encabezado. Hoy solo 8 de las 40 familias tienen datos y hay 31 códigos distintos. |
| DC, DD | `Publicación_con_A`, `Ganacia` | Vacías. No se envían al buscador. |

**Rangos de años:** si `Año_Final` está vacío, el vehículo sigue en producción (coincide al 100 % con `Final_Producción = FALSO`). Los 108 aceites no tienen años ni transmisión.

**Inconsistencias encontradas** (el buscador las lista en la sección *Calidad de datos de la hoja*, al pie de la página):

- **Publicaciones repetidas.** 1485359389 y KATSTDMVI6-XTRAIL son variaciones reales (2015-2016 / 2017). En KATCTRPL722-XTRAIL (filas 600/603) y KATCTRSFN622-XTRAIL (filas 615/617), el mismo código aparece con 7 L y 8 L, así que parece un error de captura.
- **El mismo valor escrito de dos formas.** "NS3 CVT" / "NS-3 CVT" y "2.4L" / "2.4 L". El buscador las agrupa en una sola opción.
- **Años de las variaciones.** En las variaciones de X-Trail, la descripción dice "2015-2016" o "2017", pero Año_Inicio y Año_Final tienen el rango completo (2015–2017). Por eso, al filtrar por 2017 aparecen las dos variaciones. Para separarlas, captura en cada fila los años reales de esa variación.
- **Un solo vehículo por fila.** Algunas descripciones mencionan varios modelos (ej. "Compass Patriot Renegade"), pero la fila solo registra uno. El buscador solo puede confirmar lo que esté en las columnas.

## 2. Decisiones técnicas

**Números de parte.** Se leen directo de AA:DB. Al cargar los datos se arma un índice `código → publicaciones`. Así:

- La búsqueda es **exacta por código completo**: `OMR-1000` no trae `OMR-10000` y `OMF-00` no trae nada, pero sugiere los códigos parecidos.
- No se pierden piezas sin cantidad, como sí pasa en la columna Z.
- Las columnas de piezas se detectan por su encabezado (cualquier columna seguida de `Cant._N`). Si se agrega una familia nueva, entra sola.
- La columna Z solo se usa para avisar cuando no coincide con AA:DB.

**Filtros.** Son independientes. Las opciones de cada lista se recalculan con los demás filtros activos; por ejemplo, al elegir JEEP, Modelo solo muestra COMPASS y PATRIOT, con su conteo. El campo **Año del vehículo** busca filas donde `Año_Inicio ≤ año ≤ Año_Final`; si Año_Final está vacío, el rango llega hasta el año actual. Los registros sin años (aceites) se ocultan al filtrar por año, salvo que se marque "Incluir publicaciones sin años registrados", y la pantalla avisa cuántos quedaron fuera.

**Columnas por nombre, no por letra.** Tanto el Apps Script como el buscador ubican las columnas por su encabezado. Insertar o mover columnas no rompe nada. Si se renombra una columna indispensable, la página dice exactamente cuál falta.

**Conexión con Google Sheets.** Se usa **Apps Script como aplicación web** (recomendado) en lugar de "Publicar en la web":

| | Apps Script (recomendado) | Publicar en la web (CSV) |
|---|---|---|
| ¿La hoja queda privada? | **Sí.** Solo se envían las columnas autorizadas. | No. Cualquiera con la liga ve la pestaña completa: precios, RFC, ganancia y lo que se agregue después. |
| ¿Los vendedores necesitan iniciar sesión en Google? | No | No |
| ¿Hay credenciales en el navegador? | No | No |
| ¿Qué pasa si cambian las columnas? | Se adapta solo (por nombre). | Se adapta solo (por nombre). |
| Configuración | 5 minutos, una sola vez | 1 minuto |

El buscador acepta las dos URL. Se pone una u otra en `config.js` y él detecta el formato.

**Carga eficiente.** La hoja se descarga **una sola vez** al abrir la página (≈470 KB, comprimidos ≈60 KB) y todas las búsquedas se hacen en memoria, sin volver a consultar Google. Además se guarda una copia en el navegador: la página abre al instante con la copia y actualiza en segundo plano. Si no hay conexión, sigue funcionando con la última copia y lo avisa. Si la página queda abierta, se actualiza sola al volver a ella después de 30 min, y el botón **Actualizar** fuerza la descarga.

**Archivos separados.** Se eligieron archivos separados en lugar de un solo HTML para que el mantenimiento sea simple. Para conectar o cambiar la fuente solo se edita `config.js`. La lógica de búsqueda (`core.js`) está separada de la pantalla (`app.js`) y se puede probar sola. GitHub Pages los sirve igual que un solo archivo.

```
index.html         estructura de la página
styles.css         diseño (claro/oscuro, adaptable a celular)
config.js          ← aquí va la URL de datos
core.js            lectura de la hoja, índices, búsquedas y filtros
app.js             pantalla y eventos
apps-script/Code.gs   API de solo lectura (va dentro del Google Sheets)
```

## 3. Implementación paso a paso

### A. Crear la API en Google Sheets (una sola vez)

1. Abre el Google Sheets del RECETARIO con la cuenta dueña de la hoja.
2. Ve a **Extensiones → Apps Script**.
3. Borra el contenido de `Código.gs`, pega todo `apps-script/Code.gs` y guarda.
   - Si el recetario está en otra pestaña del mismo libro, el script la detecta solo (busca la columna `#_Publicación_ML`). Para fijarla, escribe su nombre en `SHEET_NAME`.
4. Prueba: selecciona la función **probarApi** y presiona **Ejecutar**. La primera vez Google pide autorizar: *Revisar permisos → tu cuenta → Configuración avanzada → Ir a (proyecto) → Permitir*. En el *Registro de ejecución* debe salir algo como `filas: 1111 | columnas enviadas: 39`.
5. **Implementar → Nueva implementación →** ícono de engrane **→ Aplicación web**.
   - Descripción: `Buscador AFZ`
   - **Ejecutar como: Yo**
   - **Quién tiene acceso: Cualquier usuario** (*Anyone*). Esto permite que los vendedores lo usen sin iniciar sesión. La hoja sigue privada.
6. Copia la **URL de la aplicación web** (termina en `/exec`).
7. Ábrela en el navegador. Debes ver un texto que empieza con `{"ok":true,...`.

> **Si después modificas `Code.gs`**, ve a *Implementar → Gestionar implementaciones →* lápiz *→ Versión: Nueva versión → Implementar*. Así la URL no cambia.
> Los cambios en los **datos** de la hoja no requieren volver a implementar. Se ven al presionar *Actualizar* en el buscador.

### B. Conectar el buscador

En `config.js`, pega la URL:

```js
DATA_URL: 'https://script.google.com/macros/s/AKfycb.../exec',
```

### C. Publicar en GitHub Pages

1. En GitHub: **New repository** (por ejemplo `buscador-afz`). Puede ser público; el código no contiene datos ni credenciales.
2. **Add file → Upload files**: sube `index.html`, `styles.css`, `config.js`, `core.js` y `app.js` (la carpeta `apps-script` es opcional, solo como respaldo) → *Commit changes*.
3. **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
4. En 1–2 minutos queda en `https://TU-USUARIO.github.io/buscador-afz/`.

### D. Compartir con el equipo

- Envía la liga. Funciona en computadora y celular, sin instalar nada ni iniciar sesión.
- En el celular, conviene usar *Compartir → Agregar a pantalla de inicio* para abrirla como app.
- **Cada búsqueda tiene su propia liga.** La dirección cambia con lo que buscas, por ejemplo:
  `…/buscador-afz/#m=part&q=OMF-003&ma=NISSAN&y=2014`
  Se puede enviar por WhatsApp para que otra persona vea exactamente la misma consulta.

### Seguridad: qué ve quien tenga la URL

La URL del Apps Script entrega **solo** las columnas listadas en `FIELDS` (identificadores de canal, descripción, compatibilidad, precio de lista y números de parte). No entrega el RFC, la ganancia ni otras pestañas. Esa URL es pública para quien la conozca, igual que el buscador. Si en el futuro se necesita restringir el acceso por persona, la opción sencilla es cambiar *Quién tiene acceso* a *Cualquier usuario con cuenta de Google* dentro de tu organización. Eso sí obligaría a iniciar sesión.

## 4. Mantenimiento

| Cambio en la hoja | ¿Qué hay que hacer? |
|---|---|
| Agregar o editar filas | Nada |
| Capturar ASIN, UPC, URL OCF o referencia directa | Nada (se vuelven buscables solas) |
| Agregar una familia de piezas nueva (par `Familia` / `Cant._N`) | Nada |
| Insertar o mover columnas | Nada |
| Renombrar un encabezado de compatibilidad | Agregar el nombre nuevo en `FIELDS` de `Code.gs` (y volver a implementar como *Nueva versión*) y en `FIELDS` de `core.js` |
| Cambiar la URL de datos | Editar `config.js` en GitHub |

Para ver si hay datos por corregir, abre la sección **Calidad de datos de la hoja** al pie del buscador.
