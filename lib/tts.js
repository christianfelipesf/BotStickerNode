const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

const piperDir = path.join(process.cwd(), 'bin', 'piper');
const piperExe = path.join(piperDir, 'piper.exe');
const modelsDir = path.join(process.cwd(), 'models', 'tts');
const defaultModel = path.join(modelsDir, 'pt_BR-cadu-medium.onnx');

/**
 * Converte texto em áudio usando Piper TTS (Offline)
 * @param {string} text Texto a ser convertido
 * @param {string} modelPath Caminho para o modelo .onnx
 * @returns {Promise<string>} Caminho para o arquivo .opus gerado
 */
async function synthesize(text, modelPath = defaultModel) {
    if (!fs.existsSync(piperExe)) {
        throw new Error('Executável do Piper não encontrado. Execute o setup primeiro.');
    }
    if (!fs.existsSync(modelPath)) {
        throw new Error(`Modelo de voz não encontrado em ${modelPath}`);
    }

    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
    
    const wavPath = path.join(tempDir, `tts_${Date.now()}.wav`);
    const opusPath = path.join(tempDir, `tts_${Date.now()}.opus`);

    const espeakData = path.join(piperDir, 'espeak-ng-data');

    return new Promise((resolve, reject) => {
        const piper = spawn(piperExe, [
            '--model', modelPath,
            '--output_file', wavPath,
            '--espeak_data', espeakData
        ]);

        piper.stdin.write(text);
        piper.stdin.end();

        piper.on('close', async (code) => {
            if (code === 0 && fs.existsSync(wavPath)) {
                try {
                    // Converter para OPUS (encapsulado em OGG) para WhatsApp
                    await new Promise((res, rej) => {
                        ffmpeg(wavPath)
                            .audioCodec('libopus')
                            .outputOptions([
                                '-b:a 48k',
                                '-vbr on',
                                '-compression_level 10'
                            ])
                            .toFormat('ogg')
                            .on('end', res)
                            .on('error', rej)
                            .save(opusPath);
                    });
                    
                    fs.unlinkSync(wavPath); // Deletar o WAV original
                    resolve(opusPath);
                } catch (err) {
                    reject(new Error(`Erro na conversão para Opus: ${err.message}`));
                }
            } else {
                reject(new Error(`Piper finalizou com código ${code}`));
            }
        });

        piper.on('error', (err) => {
            reject(err);
        });
    });
}

module.exports = { synthesize };
