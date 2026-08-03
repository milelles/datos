# Subida Infinita — prototipo de mecánica base

Prototipo jugable (vanilla JS + Canvas, sin build step) para probar el
**feel** del salto y la generación de plataformas antes de meterle
WebSockets y salas. No hay backend ni multijugador todavía: es la base
que la sala compartida usará.

## Cómo correrlo

```bash
cd game
python3 -m http.server 8080
# abrir http://localhost:8080
```

(Tiene que ser vía servidor HTTP, no `file://`, porque usa ES modules.)

## Controles

- **Tocar / click**: salta. Mantené presionado para cargar más impulso
  (salta más alto y más lejos, pero es más difícil de calibrar — ese es
  el techo de skill).
- **Tocar/click a la izquierda o derecha** del centro de la pantalla:
  dirección del salto. Centro = salto recto.
- **Teclado**: flechas para dirección, espacio para cargar/soltar el salto.

## Qué valida este prototipo

- **Generación por semilla** (`rng.js`, `mulberry32`): la torre completa
  (gaps, posición x y tipo de cada plataforma) depende 100% de la
  semilla. Mismo seed → mismo patrón exacto. Se puede compartir con
  `?seed=NUMERO` en la URL — esto es, en miniatura, lo que la sala hará
  con todos los jugadores a la vez.
- **Salto con carga**: tap corto = salto corto y seguro; mantener
  presionado = más altura y distancia, con más riesgo de errar el
  timing.
- **Tipos de plataforma**: normales, movibles (oscilan), que se rompen
  al pisarlas, que se hunden, con pinchos (instant-fail). La mezcla de
  tipos cambia con la altura (`BIOMES` en `main.js`).
- **Ola que sube**: arranca después de un margen de gracia y acelera
  con la altura máxima alcanzada, para que quedarse quieto no sea una
  opción viable.
- **Progresión de bioma**: el color de fondo interpola entre biomas
  (praderas → nubes → hielo → cumbres → lava) según la altura.
- **Cámara de una sola dirección**: solo sube seguir al jugador nunca
  baja, así que caer por debajo de la ventana visible es la condición
  de muerte por caída (estilo Doodle Jump).

Todas las constantes de balance (gravedad, velocidades de salto, gaps
entre plataformas, velocidad de la ola, etc.) están arriba de
`main.js` para poder iterar rápido el feel.

## Qué falta (fuera de alcance de este prototipo)

- Sistema de salas: crear sala con código, invitar amigos, sincronizar
  la semilla al iniciar.
- Sincronización en tiempo real (WebSockets) de la altura/posición Y de
  cada jugador — la barra lateral de mini-avatares y las notificaciones
  ("Juan llegó a 340m").
- Fantasmas de amigos (async, modo solo contra un ghost run).
- Arte final del muñequito, partículas de salto, skins.
- Podio de fin de partida y botón de revancha con nueva semilla dentro
  de una sala real (acá ya existe el botón, pero es local/solo).
