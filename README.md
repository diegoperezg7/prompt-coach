# Prompt Coach

Mod de Claude Code que puntúa el borrador del prompt y lo reescribe antes de enviarlo. Nunca envía nada por su cuenta: siempre eliges tú.

## Qué hace

- **Puntuación mientras escribes**: `NN/100` y el nivel (flojo por debajo de 60, sólido a partir de 60), en una banda sobre el compositor.
- **Mejorar prompt / Afinar**: reescribe el borrador con Sonnet (`$.model.complete`, barato y rápido) usando la conversación reciente para no repetir contexto; si el modelo no responde, cae a reglas locales e indica el motivo. Mantiene adjuntos (`[Image #N]`), `@rutas` y pegados.
- **Panel con la propuesta**: puntuación antes y después, origen (modelo o reglas), y botones Enviar propuesta, Sustituir borrador, Deshacer, Mejorar de nuevo, Enviar original, Copiar (terminal) y Cancelar.
- **`/coach [texto]`**: lo mismo desde un comando.

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

- `hooks/register.tsx`: hooks, puntuación local, llamada al modelo y dibujo de banda y panel.
- `hooks/coach.test.tsx`: tests con el kit `claude-code/testing` (terminal y VS Code, varios anchos).
- `types/index.d.ts`: contrato del estado del mod.
