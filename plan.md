# Plan — `highlight_pathway`: rutas fisiológicas animadas

## Objetivo

Un primitivo genérico que anima un recorrido a través de una secuencia ordenada
de estructuras reales. Un solo comando sirve para beber agua, digerir comida,
la circulación por el corazón, el aire por los bronquios, la orina y la
conducción nerviosa — sin código por tema.

## Decisiones de diseño

1. **Comando genérico, no efecto por tema.** `highlight_pathway(label,
   organ_ids[], step_seconds, loop)` + `clear_pathway`. La IA resuelve los ids
   con `find_structures`, que ya existe.

2. **La animación no toca los materiales de los órganos.** Se renderiza como
   una capa aditiva independiente: un tubo que dibuja la ruta y un marcador
   luminoso que la recorre. Motivo: `OrganMesh` memoiza su material sobre
   `[organ, hovered, selected, overlay]`; mutarlo desde fuera pelearía con
   React, y suscribir `SystemMeshes` a un índice que cambia por paso
   re-renderizaría 1.110 mallas por paso. Aislarlo hace el coste de regresión
   nulo: sin ruta activa no se ejecuta nada nuevo.

3. **El reloj vive en `useFrame`, no en estado de React.** El store guarda la
   *intención* (qué ruta, cuántos segundos por paso, `seq` para reiniciar); el
   tiempo transcurrido es un `useRef`. Cero re-renders por frame.

4. **El reducer sigue puro.** Nada de `Date.now()` dentro de
   `applySceneCommand`. Se usa el contador `seq`, el mismo idioma que
   `focusRequest` ya emplea para poder re-enfocar el mismo órgano.

5. **Color violeta luminoso (`#c86bff`).** No colisiona con el cian de
   selección (`#00a8e8`) ni con el ámbar/carmesí de patología. Lee como
   anotación, no como tejido ni como enfermedad.

6. **`getPoint`, no `getPointAt`.** El parámetro crudo de la curva reparte el
   tiempo por segmento, que es exactamente la semántica de `step_seconds`. La
   parametrización por longitud de arco daría velocidad constante y tiempos
   desiguales por paso.

## Pasos

- [x] Revisar arquitectura y confirmar viabilidad
- [x] `SceneCommandSchema`: variantes `highlight_pathway` y `clear_pathway` (Zod)
- [x] `protocol.py`: espejo Pydantic sin defaults, para que el contract test cuadre
- [x] `sceneStore.ts`: estado `pathway`, casos del reducer, acción `clearPathway`
- [x] `sceneStore.test.ts`: tests del reducer (fija, reinicia, limpia, reset_view)
- [x] `PathwayFlow.tsx`: tubo + marcador animado en `useFrame`
- [x] `AnatomyScene.tsx`: montar la capa, pasar centros y escala del modelo
- [x] `PathwayBar.tsx`: chip con la etiqueta y salida (la ruta debe poder pararse)
- [x] `scene_tools.py`: tools `highlight_pathway` y `clear_pathway` con validación
- [x] `prompts.py`: cuándo usarla
- [x] `test_scene_tools.py`: ids inválidos, longitud, duplicados, rango
- [x] Verificar: pytest (87 passed) + vitest (167 passed) + typecheck (0 errors)
- [x] Reconstruir sidecar (PyInstaller, venv Python 3.12) e instalador (Tauri MSI + NSIS)

## Riesgos aceptados

- **Órganos de la ruta cuyo sistema está apagado** no tienen centro medido y se
  omiten con un `console.warn`. Con menos de 2 puntos no se dibuja nada.
- **`loop: true` salta del final al inicio.** Correcto para circulación, un
  corte visible para la deglución. Documentado, no disimulado.
- **El orden lo decide la IA.** Si lo ordena mal, enseña anatomía incorrecta.
  Mismo perfil de riesgo que `apply_pathology_overlay`, ya aceptado, con las
  mismas mitigaciones (validación de ids + disclaimer de no-dispositivo-médico).
