# Instalação e Teste Local

## Pré-requisitos

- Node.js >= 18.0.0
- npm ou yarn

## Instalação Local (para desenvolvimento)

### 1. Clone o repositório

```bash
git clone https://github.com/Academico-JZ/AG-JZ.git
cd AG-JZ
```

### 2. Instale as dependências

```bash
npm install
```

### 3. Link globalmente (modo desenvolvimento)

```bash
npm link
```

Agora o comando `ag-unified` estará disponível globalmente no seu sistema.

## Testando os Comandos

### Ver ajuda

```bash
ag-unified --help
```

### Sincronizar um kit específico

```bash
ag-unified sync github:anthonylee991/gemini-superpowers-antigravity
```

### Sincronizar todos os kits padrão

```bash
ag-unified sync --all
```

### Ver status dos kits instalados

```bash
ag-unified status
```

### Criar link simbólico no workspace atual

```bash
cd /caminho/para/seu/projeto
ag-unified link
```

### Modo dry-run (ver o que seria feito sem executar)

```bash
ag-unified sync --all --dry-run
```

## Estrutura Criada

Após executar `ag-unified sync --all`, a seguinte estrutura será criada:

```
~/.gemini/antigravity/.agent/
├── workflows/
│   ├── superpowers-write-plan.md
│   ├── superpowers-execute-plan.md
│   └── ... (outros workflows mesclados)
├── skills/
│   ├── superpowers-tdd/
│   ├── superpowers-brainstorm/
│   └── ... (outras skills mescladas)
├── rules/
│   └── ... (regras mescladas)
└── .sync-registry.json  (rastreamento de kits)
```

## Desinstalação

Para remover o link global:

```bash
npm unlink -g @academico-jz/ag-unified
```

## Publicação no NPM (futuro)

Quando estiver pronto para publicar:

```bash
npm login
npm publish --access public
```
