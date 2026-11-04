<p align="right"><a href="README.md">English</a> · <b>Español</b></p>

<p align="center">
  <img src="assets/banner-es.svg" alt="Prompt Coach: puntúa tu prompt mientras escribes y lo reescribe antes de enviarlo" width="100%">
</p>

<p align="center">
  <img alt="Versión" src="https://img.shields.io/badge/versi%C3%B3n-1.2.1-7C3AED?style=flat-square">
  <img alt="Claude Code" src="https://img.shields.io/badge/Claude%20Code-mod-7C3AED?style=flat-square">
  <img alt="Tests" src="https://img.shields.io/badge/tests-16%20passing-15803d?style=flat-square">
  <img alt="Modelo" src="https://img.shields.io/badge/modelo-Haiku-5b5b6b?style=flat-square">
  <img alt="Idiomas" src="https://img.shields.io/badge/interfaz-EN%20%C2%B7%20ES-5b5b6b?style=flat-square">
  <img alt="Licencia" src="https://img.shields.io/badge/licencia-MIT-5b5b6b?style=flat-square">
</p>

<p align="center">
  <b>Mod de Claude Code</b> que puntúa el borrador del prompt contra una rúbrica real y lo reescribe con Haiku antes de enviarlo.<br>
  Nunca envía nada por su cuenta: siempre eliges tú.
</p>

---

## La nota, mientras escribes

Una banda sobre el compositor puntúa cada tecla: ámbar por debajo de 60, verde a partir de ahí. Aquí pasa de **5** a **75** al añadir ruta, comportamiento esperado, un test y una restricción.

<p align="center"><img src="assets/live-es.gif" alt="La puntuación sube de 5 a 75 mientras se escribe el prompt" width="100%"></p>

## Mejorar con un comando

`/coach` (o el botón de la banda) reescribe el borrador con Haiku usando la conversación reciente y abre un panel con la propuesta. Desde ahí puedes sustituir el borrador, deshacerlo, mejorarlo de nuevo, copiarlo o cancelar. Grabación real: **48 → 100**.

<p align="center"><img src="assets/coach-es.gif" alt="El comando coach abre el panel con la propuesta de 48 a 100 y sustituye el borrador" width="100%"></p>

## Cómo funciona

<p align="center"><img src="assets/flow-es.svg" alt="Flujo: borrador, rúbrica en vivo, Haiku reescribe, segunda pasada si hace falta, panel y tú eliges" width="88%"></p>

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

## Haiku o Sonnet

<p align="center"><img src="assets/benchmark-es.svg" alt="Haiku cuesta 0,0007 dólares por mejora frente a 0,0114 de Sonnet, con nota y utilidad casi iguales" width="88%"></p>

12 borradores reales (`bench/cases.mts`), el mismo flujo que el mod y un juez Opus ciego que puntúa fidelidad, datos inventados y utilidad:

| Modelo | Nota media | A 100 | Inventados | Utilidad | Coste por mejora | Latencia |
|---|---|---|---|---|---|---|
| **Haiku** | 93,5 | 5/12 | 3 | 7,8/10 | **0,0007 $** | **5,2 s** |
| Sonnet | 95,3 | 5/12 | 1 | 8,0/10 | 0,0114 $ | 6,0 s |

Haiku cuesta 16 veces menos con casi la misma calidad, y por eso es el modelo por defecto. Se puede repetir con `node --experimental-strip-types bench/run.mts haiku,sonnet opus`.

## Instalar

Desde el prompt de Claude Code:

```
/plugin install prompt-coach --marketplace diegoperezg7/prompt-coach
```

Responde `y` para añadir el marketplace y elige el ámbito de usuario: así funciona en el terminal y en la extensión de VS Code, que comparten los plugins del usuario. Desde un shell: `claude plugin install prompt-coach --marketplace diegoperezg7/prompt-coach`.

## Idioma

Interfaz en español y en inglés. La opción `language` del plugin (`/plugin`, Prompt Coach, configurar) acepta:

| Valor | Interfaz |
|---|---|
| `auto` (por defecto) | sigue el idioma del borrador |
| `en` | siempre en inglés |
| `es` | siempre en español |

La propuesta se escribe siempre en el idioma del borrador, que es el idioma en el que trabajas.

## Por superficie

| Superficie | Puntuación en vivo | Botón | Retención en Enter |
|---|---|---|---|
| Terminal y app de escritorio | a cada tecla | banda (`m`) y `/coach` | no |
| Extensión de VS Code | sondeo del compositor cada segundo (la extensión no envía las teclas) | banda y `/coach` | sí: un prompt flojo de trabajo se retiene y abre el panel; los sólidos, las preguntas, los comandos y los mensajes con adjuntos pasan |

## Desarrollo

```
claude --plugin-dir .        # cargar sin instalar
claude plugin test .         # 16 tests: terminal, escritorio y VS Code, varios anchos y altos, los dos idiomas
claude plugin validate .
```

| Fichero | Qué hay |
|---|---|
| `core/rubric.ts` | rúbrica, prompts del modelo y motor local, sin dependencias de Claude Code |
| `hooks/register.tsx` | hooks, llamadas al modelo, banda y panel |
| `hooks/coach.test.tsx` | tests con el kit `claude-code/testing` |
| `bench/` | benchmark de modelos con juez ciego |
| `types/index.d.ts` | contrato del estado del mod |
| `assets/demo.mp4` | vídeo de 35 s en inglés, listo para compartir |

## Licencia

MIT
