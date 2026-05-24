# RimWorld Layout Optimizer

Web app para diseñar y optimizar el plano de una colonia de RimWorld. Defines las salas que quieres, qué links de adyacencia (hard o soft) deben respetarse, y un optimizer LNS coloca cada sala en el grid minimizando una función de coste.

## Por qué existe

[`CameronHudson8/rimworld-base-planner`](https://github.com/CameronHudson8/rimworld-base-planner) ya hace esto, pero su core (simulated annealing con swaps de 1 celda) se atasca cuando una sala completa debería migrar a otra zona del grid: para hacerlo necesita pasar por estados fragmentados que el SA rechaza. Se nota mucho en bases medianas-grandes con muchos hard links.

Este repo usa un core distinto: **Large Neighborhood Search (LNS)**. En cada iteración destruye 4-8 salas problemáticas (las que tienen links sin satisfacer o fragmentación) y las reconstruye una por una en la mejor región contigua disponible. Eso permite que una sala entera salte de una esquina del grid a otra en un solo paso.

En el preset late-game vainilla (9×9, 45 salas, 49 links) el viejo SA tardaba ~5 minutos y dejaba 1-2 hard sin satisfacer. Esta versión satisface todos los hard en ~2 segundos.

## Stack

- Vite + React 18 + TypeScript.
- Vitest para tests.
- Web Worker para correr el optimizer sin bloquear la UI.
- localStorage para persistencia.
- Sin CSS framework (CSS inline, suficiente para esta UI).

## Arrancar

```bash
npm install
npm run dev          # http://localhost:5173
npm run test         # watch mode
npm run test:run     # one-shot, CI-friendly
npm run build        # bundle a dist/
```

## Uso

1. Al cargar la app por primera vez tienes el preset late-game vainilla (45 salas, 49 links). Editable desde la barra lateral.
2. Pulsa **Optimize**. Tarda 1-3 segundos. La energía baja, el Adjacency Report se actualiza, y el grid se redibuja.
3. Si algún link no se satisface, aparece marcado en rojo (hard) o naranja (soft) en el Adjacency Report con su peso.

Persistencia: cada cambio se guarda automáticamente en `localStorage`. Para volver al preset original pulsa "Cargar preset". Para versionar/compartir un layout, usa "Exportar JSON" / "Importar JSON".

## Modelo de coste

Para cada layout se calcula `energy = adjacency + fragmentation + compactness`:

- **adjacency**: por cada link no satisfecho, `weight × (flat_penalty + manhattan²)`. `flat_penalty` es 100,000 para hard, 1,000 para soft. La componente manhattan da gradiente al optimizer cuando las dos salas no se tocan pero se están acercando.
- **fragmentation**: si una sala queda partida en >1 componente 4-conexo, cada celda fuera del componente mayoritario cuesta `(manhattan_a_main + 1) × 5,000`. Suficientemente caro para que el optimizer prefiera dejar un soft link sin satisfacer antes que entregar una sala dividida (cosa no construible en el juego).
- **compactness**: distancia cuadrada media entre todas las parejas de celdas de cada sala. Bajo peso (sqrt) — sólo desempata.

## Limitaciones conocidas

- El optimizer es estocástico. Mismo input, runs distintos → soluciones algo distintas. Las garantías duras (0 hard sin satisfacer, 0 sala fragmentada) se cumplen consistentemente en el preset.
- No se garantiza el óptimo global. Si una sala tiene N otras pidiéndole adyacencia y solo cabe en X lados (X < N), N-X links van a quedar sin satisfacer por **física**, no por mal algoritmo. El optimizer no puede romper restricciones topológicas.
- Sin contenido de DLC en el preset (Royalty/Ideology/Biotech). Puedes añadirlas a mano desde la UI.

## Estructura

```
src/
  model/        types, layout helpers, cost function
  optimizer/    LNS + greedy polish
  presets/      late-game-vanilla.ts
  worker/       Web Worker + cliente del thread principal
  components/   Grid, RoomList, LinkList, AdjacencyReport
  app/          storage helpers
  App.tsx       composición + state
```

## Tests

```bash
npm run test:run
```

Cubre:
- LNS es monotónico (re-ejecutar nunca empeora).
- Hard links se satisfacen en escenarios simples.
- En el preset late-game completo: 0 hard sin satisfacer, 0 sala fragmentada.

## License

ISC (sin restricciones para uso personal/colonia).
