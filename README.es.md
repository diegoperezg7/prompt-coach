<p align="right"><a href="README.md">English</a> · <b>Español</b></p>

<p align="center">
  <img src="assets/banner-es.svg" alt="Prompt Coach: puntúa tu prompt mientras escribes y lo reescribe antes de enviarlo" width="100%">
</p>

<p align="center">
  <img alt="Versión" src="https://img.shields.io/badge/versi%C3%B3n-1.3.1-7C3AED?style=flat-square">
  <img alt="Claude Code" src="https://img.shields.io/badge/Claude%20Code-mod-7C3AED?style=flat-square">
  <img alt="Tests" src="https://img.shields.io/badge/tests-24%20passing-15803d?style=flat-square">
  <img alt="Modelos" src="https://img.shields.io/badge/modelos-Haiku%20%C2%B7%20Sonnet%20%C2%B7%20Opus-5b5b6b?style=flat-square">
  <img alt="Idiomas" src="https://img.shields.io/badge/idiomas-6-5b5b6b?style=flat-square">
  <img alt="Licencia" src="https://img.shields.io/badge/licencia-MIT-5b5b6b?style=flat-square">
</p>

<p align="center">
  <b>Mod de Claude Code</b> que puntúa el borrador del prompt contra una rúbrica real y lo reescribe antes de enviarlo.<br>
  Eliges el modelo, el idioma y lo detallada que es la propuesta.<br>
  Nunca envía nada por su cuenta: siempre eliges tú.
</p>

---

## La nota, mientras escribes

Una banda sobre el compositor puntúa cada tecla: ámbar por debajo de 60, verde a partir de ahí. Aquí pasa de **5** a **75** al añadir ruta, comportamiento esperado, un test y una restricción.

<p align="center"><img src="assets/live-es.gif" alt="La puntuación sube de 5 a 75 mientras se escribe el prompt" width="100%"></p>

## Mejorar con un comando

`/coach` (o el botón de la banda) reescribe el borrador con el modelo que elijas (Haiku por defecto) usando la conversación reciente y abre un panel con la propuesta. Desde ahí puedes sustituir el borrador, deshacerlo, mejorarlo de nuevo, copiarlo o cancelar. Grabación real: **48 → 100**.

<p align="center"><img src="assets/coach-es.gif" alt="El comando coach abre el panel con la propuesta de 48 a 100 y sustituye el borrador" width="100%"></p>

## Cómo funciona

<p align="center"><img src="assets/flow-es.svg" alt="Flujo: borrador, rúbrica en vivo, el modelo reescribe, segunda pasada si hace falta, panel y tú eliges" width="88%"></p>

## Una nota honesta

<p align="center"><img src="assets/rubric-es.svg" alt="Rúbrica de 100 puntos: objetivo 20, aceptación 20, contexto 15, detalle 15, restricciones 15, formato 10, claridad 5" width="88%"></p>

| Criterio | Puntos | Cuenta si |
|---|---|---|
| Objetivo | 20 | hay qué conseguir, con verbo y objeto |
| Contexto | 15 | hay ruta, archivo, `símbolo` o @mención **que aparece en el borrador o la conversación** |
| Detalle | 15 | dos datos concretos: actual y esperado, error, ejemplo, cifra, adjunto |
| Criterio de aceptación | 20 | dice cuándo está hecho (12 si solo pide verificar) |
| Restricciones | 15 | dos límites: qué no tocar, alcance |
| Formato de respuesta | 10 | dice qué devolver |
| Claridad | 5 | sin «esto», «lo de», «algo» ni huecos `[...]` |

- **No se infla.** Una ruta que el modelo se inventa no puntúa, y el prompt de reescritura le prohíbe afirmar datos del proyecto que no consten.
- **Un 100 se gana.** Solo llega cuando el borrador o la conversación traen la ubicación y los datos. Sin ellos la propuesta se queda en 86-93, pide al agente que lo averigüe y el panel dice qué falta: `Falta para 100: contexto 8/15`.

## Se adapta a cualquier terminal

<table>
  <tr>
    <td width="44%"><img src="assets/narrow-es.gif" alt="En un terminal estrecho la banda deja la nota y el botón, y el panel se coloca encima del prompt" width="100%"></td>
    <td>
      <ul>
        <li><b>Estrecho</b> (menos de 40 columnas): la banda deja solo la nota y el botón.</li>
        <li><b>Bajo</b>: los botones suben encima del editor, que mide lo que queda libre (3 a 14 filas), y lo que falta para 100 pasa a formato corto.</li>
        <li><b>Ancho</b>: el panel se acopla al lado del transcript.</li>
        <li><b>Sin sitio para el panel</b>: <code>/coach</code> devuelve la propuesta en el propio transcript.</li>
        <li>Ghostty, iTerm, Terminal.app y el terminal integrado de VS Code: es Claude Code quien pinta la interfaz, así que el mod funciona igual en todos.</li>
      </ul>
    </td>
  </tr>
</table>

## Haiku, Sonnet u Opus

<p align="center"><img src="assets/benchmark-es.svg" alt="Coste por mejora: Haiku 0,00055 $, Sonnet 0,0111 $, Opus 0,0239 $, con nota y utilidad casi iguales" width="88%"></p>

16 borradores reales en seis idiomas (`bench/cases.mts`), el mismo flujo que el mod y un juez Opus ciego que puntúa fidelidad, datos inventados, utilidad y si la propuesta sale en el idioma del borrador:

| Modelo | Nota media | A 100 | Inventados | Utilidad | Idioma correcto | Coste por mejora | Latencia |
|---|---|---|---|---|---|---|---|
| **Haiku** (por defecto) | 93,4 | 4/16 | 6 | 7,5/10 | 16/16 | **0,00055 $** | **3,8 s** |
| Sonnet | 93,5 | 4/16 | 6 | 7,9/10 | 16/16 | 0,0111 $ | 5,4 s |
| Opus | 94,8 | 5/16 | 4 | 8,0/10 | 16/16 | 0,0239 $ | 7,5 s |

Opus escribe propuestas algo más útiles a 43 veces el coste de Haiku; lo eliges tú con la opción `model`. Se repite con `node --experimental-strip-types bench/run.mts haiku,sonnet,opus opus balanced`.

## Instalar

Desde el prompt de Claude Code:

```
/plugin install prompt-coach --marketplace diegoperezg7/prompt-coach
```

Responde `y` para añadir el marketplace y elige el ámbito de usuario: así funciona en el terminal y en la extensión de VS Code, que comparten los plugins del usuario. Desde un shell: `claude plugin install prompt-coach --marketplace diegoperezg7/prompt-coach`.

## Ajustes

Tres opciones en `/plugin`, Prompt Coach, configurar:

| Opción | Valores | Por defecto |
|---|---|---|
| `model` | `haiku`, `sonnet`, `opus`: el modelo que reescribe | `haiku` |
| `language` | `auto`, `en`, `es`, `fr`, `de`, `pt`, `it`: idioma de la interfaz; `auto` sigue al borrador | `auto` |
| `verbosity` | `concise`, `balanced`, `detailed`: longitud de la propuesta | `balanced` |

La rúbrica entiende borradores en los seis idiomas, y la propuesta se escribe siempre en el idioma del borrador. La verbosidad, medida con Haiku sobre los 16 borradores:

| Verbosidad | Palabras de media | Nota media | Utilidad |
|---|---|---|---|
| `concise` | 101 | 89,5 | 7,9/10 |
| `balanced` | 247 | 93,4 | 7,5/10 |
| `detailed` | 332 | 93,4 | 7,8/10 |

Con menos texto caben menos restricciones y detalles, así que la nota baja un poco; el juez las ve igual de útiles.

## Por superficie

| Superficie | Puntuación en vivo | Botón | Retención en Enter |
|---|---|---|---|
| Terminal y app de escritorio | a cada tecla | banda (`m`) y `/coach` | no |
| Extensión de VS Code | sondeo del compositor cada segundo (la extensión no envía las teclas) | banda y `/coach` | sí: un prompt flojo de trabajo se retiene y abre el panel; los sólidos, las preguntas, los comandos y los mensajes con adjuntos pasan |

## Desarrollo

```
claude --plugin-dir .        # cargar sin instalar
claude plugin test .         # 24 tests: terminal, escritorio y VS Code, anchos y altos, idiomas, ajustes
claude plugin validate .
```

| Fichero | Qué hay |
|---|---|
| `core/rubric.ts` | rúbrica, prompts del modelo y motor local, sin dependencias de Claude Code |
| `hooks/register.tsx` | hooks, llamadas al modelo, banda y panel |
| `hooks/i18n.ts` | textos de la interfaz en seis idiomas |
| `hooks/coach.test.tsx` | tests con el kit `claude-code/testing` |
| `bench/` | benchmark de modelos con juez ciego |
| `types/index.d.ts` | contrato del estado del mod |
| `CHANGELOG.md` | historial de versiones (en inglés) |
| `assets/demo.mp4` | vídeo de 35 s en inglés, listo para compartir |

## Licencia

MIT
