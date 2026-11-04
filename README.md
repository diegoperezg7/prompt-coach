# Prompt Coach

Mod de Claude Code que puntúa el borrador del prompt y lo reescribe antes de enviarlo. Nunca envía nada por su cuenta: siempre eliges tú.

## Qué hace

- **Puntuación mientras escribes**: `NN/100` y el nivel (flojo por debajo de 60, sólido a partir de 60), en una banda sobre el compositor.
- **Mejorar prompt / Afinar**: reescribe el borrador con Haiku (`$.model.complete`, barato y rápido) usando la conversación reciente para no repetir contexto; si el modelo no responde, cae a reglas locales e indica el motivo. Mantiene adjuntos (`[Image #N]`), `@rutas` y pegados.
- **Panel con la propuesta**: puntuación antes y después, origen (modelo o reglas), y botones Enviar propuesta, Sustituir borrador, Deshacer, Mejorar de nuevo, Enviar original, Copiar (terminal) y Cancelar.
- **`/coach [texto]`**: lo mismo desde un comando.

## Rúbrica

La nota es la suma de siete criterios (`core/rubric.ts`), y el panel dice cuáles faltan para llegar a 100:

| Criterio | Puntos | Cuenta si |
|---|---|---|
| Objetivo | 20 | hay qué conseguir con verbo y objeto (8 palabras o más) |
| Contexto | 15 | hay ruta, archivo, `símbolo` o @mención **que aparece en el borrador o la conversación**; una ruta inventada no puntúa |
| Detalle | 15 | dos datos concretos: actual/esperado, error, ejemplo, cifra, adjunto |
| Criterio de aceptación | 20 | dice cuándo está hecho (12 si solo pide verificar) |
| Restricciones | 15 | dos límites: qué no tocar, alcance |
| Formato de respuesta | 10 | dice qué devolver |
| Claridad | 5 | sin «esto», «lo de», «algo» ni huecos `[...]` |

Si la primera reescritura deja huecos que el modelo puede cubrir sin datos nuevos, hace una segunda pasada dirigida y se queda con la mejor. Un 100 solo sale cuando el borrador o la conversación traen la ubicación y los datos; sin ellos la propuesta se queda en 86-93 y pide al agente que lo averigüe.

## Benchmark

`node --experimental-strip-types bench/run.mts haiku,sonnet opus`: 12 borradores reales (`bench/cases.mts`), el mismo flujo que el mod, y un juez Opus ciego que puntúa fidelidad, datos inventados y utilidad. Resultado del 2026-11-04:

| Modelo | Nota media | A 100 | Inventados | Utilidad (juez) | Coste por mejora | Latencia |
|---|---|---|---|---|---|---|
| Haiku | 93,5 | 5/12 | 3 | 7,8/10 | 0,0007 $ | 5,2 s |
| Sonnet | 95,3 | 5/12 | 1 | 8,0/10 | 0,0114 $ | 6,0 s |

Haiku cuesta 16 veces menos con casi la misma calidad: es el modelo por defecto.

## Por superficie

| Superficie | Puntuación en vivo | Botón | Retención en Enter |
|---|---|---|---|
| Terminal (Ghostty, terminal integrado) y app de escritorio | a cada tecla | banda con `m` | no |
| Extensión de VS Code | por sondeo del compositor (1 s), porque la extensión no envía las teclas | banda | sí: un prompt flojo de trabajo se retiene y abre el panel; los sólidos, las preguntas, los comandos y los mensajes con adjuntos pasan |

## Instalar

Desde el prompt de una sesión de terminal:

```
/plugin install prompt-coach --marketplace diegoperezg7/prompt-coach
```

Responde `y` para añadir el marketplace y elige el ámbito de usuario. Desde un shell: `claude plugin install prompt-coach --marketplace diegoperezg7/prompt-coach`. Vale para terminal y para la extensión de VS Code, que comparten los plugins del usuario.

Modo desarrollo sin instalar: `claude --plugin-dir ./prompt-coach`, o `CLAUDE_CODE_PLUGIN_DIRS=/ruta/prompt-coach` en el bloque `env` de `~/.claude/settings.json`.

## Comprobar

```
claude plugin test .
claude plugin validate .
```

## Ficheros

- `core/rubric.ts`: rúbrica, prompts del modelo y motor local, sin dependencias de Claude Code.
- `hooks/register.tsx`: hooks, llamada al modelo y dibujo de banda y panel.
- `bench/`: benchmark de modelos.
- `hooks/coach.test.tsx`: tests con el kit `claude-code/testing` (terminal y VS Code, varios anchos).
- `types/index.d.ts`: contrato del estado del mod.
