const { withTimeout, TimeoutError, createCancelScope } = require('./timeout');

/**
 * Executa cmd.execute com timeout anti-zumbi.
 * - Marca cancelToken + aborta signal no timeout (comando cooperativo para de verdade).
 * - Erro tipado TimeoutError (callers detectam via err.code === 'ETIMEDOUT' ou /timeout/).
 * - Sem Promise.race órfão sem handler: withTimeout já anexa catch na perdedora.
 */
async function runCommandWithTimeout(cmd, sock, m, context, timeoutMs) {
    const scope = createCancelScope();
    context.cancelToken = scope.cancelToken;
    context.abortSignal = scope.abortController.signal;

    const label = `!${context.commandName || cmd.name || 'cmd'}`;
    const execPromise = cmd.execute(sock, m, context);

    try {
        return await withTimeout(execPromise, timeoutMs, label, {
            signal: scope.abortController.signal,
            onTimeout: () => scope.cancel(`${label} timeout ${timeoutMs}ms`),
        });
    } catch (e) {
        // Garante que trabalho cooperativo pare mesmo se o comando ignorar o signal.
        scope.cancel(e?.message || 'timeout');
        throw e;
    }
}

module.exports = { runCommandWithTimeout, TimeoutError };
