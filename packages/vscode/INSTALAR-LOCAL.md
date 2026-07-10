# Instalar a extensão Sensegrep localmente (VS Code / Cursor)

Este guia usa o arquivo `.vsix` gerado a partir do repositório, sem depender do Marketplace.

## Pré-requisitos

- VS Code 1.85+ ou Cursor com suporte a extensões VSIX
- Node.js 20+ (para rebuild, se necessário)
- Build do monorepo concluído (`npm run build` na raiz)

## 1. Gerar o pacote (se ainda não existir)

Na raiz do repositório:

```powershell
cd C:\Users\stahl\Documents\sensegrep
npm run build
npm run package --workspace packages/vscode
```

O arquivo gerado fica em:

```
packages/vscode/sensegrep-0.1.23.vsix
```

## 2. Instalar no VS Code

```powershell
code --install-extension "C:\Users\stahl\Documents\sensegrep\packages\vscode\sensegrep-0.1.23.vsix" --force
```

## 3. Instalar no Cursor

```powershell
cursor --install-extension "C:\Users\stahl\Documents\sensegrep\packages\vscode\sensegrep-0.1.23.vsix" --force
```

Se o comando `cursor` não estiver no PATH, use a paleta de comandos:

1. `Ctrl+Shift+P`
2. **Extensions: Install from VSIX...**
3. Selecione `packages/vscode/sensegrep-0.1.23.vsix`

## 4. Verificar instalação

```powershell
code --list-extensions --show-versions | Select-String sensegrep
```

Deve aparecer algo como:

```
sensegrep.sensegrep@0.1.23
```

## 5. Configuração recomendada

A extensão embute `@sensegrep/core@1.4.0` com suporte a TypeScript, JavaScript, Python, Java e Vue.

Para embeddings via Bedrock (mesma config do CLI global):

- `sensegrep.embeddings.provider`: `bedrock`
- credenciais AWS via perfil/variáveis de ambiente padrão do SDK

Para Gemini:

- comando **Sensegrep: Set Gemini API Key**
- ou variável `GEMINI_API_KEY`

## 6. Atualizar depois de mudanças no repo

Sempre regenere e reinstale:

```powershell
cd C:\Users\stahl\Documents\sensegrep
npm run build
npm run package --workspace packages/vscode
code --install-extension ".\packages\vscode\sensegrep-0.1.23.vsix" --force
```

## Versão incluída neste build

- Extensão: `0.1.23`
- Core embutido: `@sensegrep/core@1.4.0`
- Linguagens: TypeScript, JavaScript, Python, Java, Vue
