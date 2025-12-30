# Arquitetura Multilingual do Sensegrep

## Visão Geral

Esta arquitetura permite que o Sensegrep suporte múltiplas linguagens de programação (TypeScript, JavaScript, Python, e futuras) mantendo uma API de busca unificada e elegante.

---

## Conceitos Fundamentais

### Dois Eixos Ortogonais

1. **Conceito Semântico** (universal): function, class, method, type, variable, enum, module
2. **Variante Específica** (por linguagem): interface vs type_alias vs dataclass vs protocol

A solução separa esses dois eixos em **filtros independentes**:

```
symbolType  = O QUE é (conceito universal)
variant     = QUAL TIPO específico (refinamento opcional)
```

---

## Arquitetura de Filtros

```typescript
interface SearchFilters {
  // ══════════════════════════════════════════════
  // EIXO 1: Conceito Semântico (Universal)
  // ══════════════════════════════════════════════
  symbolType?: 
    | "function"   // Qualquer função
    | "class"      // Qualquer classe
    | "method"     // Método de classe
    | "type"       // Definição de tipo (interface, dataclass, protocol, etc.)
    | "variable"   // Variável/constante
    | "enum"       // Enumeração
    | "module"     // Namespace (TS) / módulo

  // ══════════════════════════════════════════════
  // EIXO 2: Variante Específica (Refinamento)
  // ══════════════════════════════════════════════
  variant?: string  // "interface", "dataclass", "protocol", "async", etc.

  // ══════════════════════════════════════════════
  // MODIFICADORES BOOLEANOS (Cross-Language)
  // ══════════════════════════════════════════════
  isExported?: boolean   // Público (export TS / não _ Python)
  isAsync?: boolean      // async function/method
  isStatic?: boolean     // static method
  isAbstract?: boolean   // abstract class/method

  // ══════════════════════════════════════════════
  // MÉTRICAS (Cross-Language)
  // ══════════════════════════════════════════════
  minComplexity?: number
  maxComplexity?: number
  hasDocumentation?: boolean

  // ══════════════════════════════════════════════
  // CONTEXTO (Cross-Language)
  // ══════════════════════════════════════════════
  parentScope?: string   // Classe/módulo pai
  decorator?: string     // "@property", "@dataclass", etc.

  // ══════════════════════════════════════════════
  // FILTRO DE LINGUAGEM
  // ══════════════════════════════════════════════
  language?: "typescript" | "javascript" | "python"
}
```

---

## Mapeamento de Variantes

| symbolType | variant     | TypeScript             | Python                |
| ---------- | ----------- | ---------------------- | --------------------- |
| function   | *(none)*    | function, arrow        | def                   |
| function   | `async`     | async function         | async def             |
| function   | `generator` | function*              | def + yield           |
| class      | *(none)*    | class                  | class                 |
| class      | `dataclass` | -                      | @dataclass            |
| class      | `abstract`  | abstract class         | ABC                   |
| method     | *(none)*    | method                 | def in class          |
| method     | `static`    | static method          | @staticmethod         |
| method     | `classmethod` | -                    | @classmethod          |
| method     | `property`  | get/set accessor       | @property             |
| method     | `abstract`  | abstract method        | @abstractmethod       |
| type       | *(none)*    | interface + type_alias | Protocol + TypedDict  |
| type       | `interface` | interface              | Protocol              |
| type       | `alias`     | type X = ...           | TypeAlias             |
| type       | `schema`    | -                      | TypedDict, NamedTuple |
| variable   | *(none)*    | const/let/var          | assignment            |
| variable   | `constant`  | const UPPER_CASE       | UPPER_CASE = ...      |
| enum       | *(none)*    | enum                   | class(Enum)           |
| module     | *(none)*    | namespace              | *(arquivo = módulo)*  |

---

## Exemplos de Uso

### Buscas Cross-Language

```typescript
// Todas as funções de qualquer linguagem
{ query: "authentication", symbolType: "function" }

// Todos os tipos (interfaces TS + dataclasses Python + protocols)
{ query: "user model", symbolType: "type" }

// Todas as funções async (TS e Python)
{ query: "fetch data", symbolType: "function", isAsync: true }

// Métodos estáticos de qualquer linguagem
{ query: "utility", symbolType: "method", isStatic: true }
```

### Buscas Específicas TypeScript

```typescript
// Só interfaces (não type aliases)
{ query: "repository", symbolType: "type", variant: "interface", language: "typescript" }

// Só type aliases
{ query: "config", symbolType: "type", variant: "alias", language: "typescript" }

// Namespaces
{ query: "utils", symbolType: "module", language: "typescript" }
```

### Buscas Específicas Python

```typescript
// Só dataclasses
{ query: "entity", symbolType: "class", variant: "dataclass" }

// Só Protocols
{ query: "interface", symbolType: "type", variant: "interface", language: "python" }

// Métodos com @property
{ query: "getter", symbolType: "method", decorator: "@property" }

// Métodos @classmethod
{ query: "factory", symbolType: "method", variant: "classmethod" }

// Classes abstratas (ABC)
{ query: "base", symbolType: "class", isAbstract: true, language: "python" }
```

### Buscas Avançadas

```typescript
// Funções complexas sem documentação
{ query: "refactor", symbolType: "function", minComplexity: 10, hasDocumentation: false }

// Métodos públicos de uma classe específica
{ query: "api", symbolType: "method", parentScope: "UserService", isExported: true }

// Todos os decorators @dataclass com complexidade baixa
{ query: "model", decorator: "@dataclass", maxComplexity: 5 }
```

---

## Arquitetura de Implementação

### Estrutura de Arquivos

```
packages/core/src/semantic/
├── language/
│   ├── types.ts              # LanguageSupport interface
│   ├── registry.ts           # Language registry
│   ├── typescript.ts         # TypeScript implementation
│   └── python.ts             # Python implementation
├── chunking-unified.ts       # Chunking que usa LanguageSupport
└── ... (arquivos existentes)
```

### Interface LanguageSupport

```typescript
export interface LanguageSupport {
  readonly id: "typescript" | "javascript" | "python"
  readonly extensions: readonly string[]
  readonly parserWasm: string
  readonly reservedWords: ReadonlySet<string>

  // Verifica se node é boundary de chunk
  isChunkBoundary(node: SyntaxNode): boolean

  // Extrai metadados completos de um node
  extractMetadata(node: SyntaxNode, filePath: string): ChunkMetadata

  // Calcula complexidade
  calculateComplexity(node: SyntaxNode): number

  // Detecta se é exportado/público
  isExported(node: SyntaxNode): boolean

  // Extrai decorators
  extractDecorators(node: SyntaxNode): string[]
}

export interface ChunkMetadata {
  symbolName?: string
  symbolType: "function" | "class" | "method" | "type" | "variable" | "enum" | "module"
  variant?: string
  language: string
  isExported: boolean
  isAsync: boolean
  isStatic: boolean
  isAbstract: boolean
  decorators: string[]
  complexity: number
  hasDocumentation: boolean
  parentScope?: string
}
```

---

## Por que esta Arquitetura?

### 1. Separação de Conceitos
- `symbolType` = conceito universal
- `variant` = especificidade
- Cada filtro tem responsabilidade clara

### 2. Granularidade Máxima Preservada
- Quer só `interface` TS? → `symbolType: "type", variant: "interface"`
- Quer só `@dataclass`? → `variant: "dataclass"`
- Nenhuma perda de capacidade

### 3. Cross-Language por Padrão
- `symbolType: "function"` → retorna de TODAS as linguagens
- Adicionar `language: "python"` para restringir
- Busca unificada é o comportamento natural

### 4. Extensibilidade
Adicionar Go, Rust, Java:
- Só adicionar novas variants
- O enum `symbolType` não cresce

### 5. Modificadores Universais
`isAsync`, `isStatic`, `isAbstract`, `isExported` funcionam em QUALQUER linguagem.

### 6. Decorator como Filtro de Primeira Classe
`decorator: "@property"` como filtro dedicado é mais poderoso.

---

## Validação: Zero Perda de Capacidade

### Capacidades TypeScript (mantidas)

| Busca Anterior          | Nova Sintaxe                             |
| ----------------------- | ---------------------------------------- |
| `symbolType: "function"`  | `symbolType: "function"`                   |
| `symbolType: "class"`     | `symbolType: "class"`                      |
| `symbolType: "method"`    | `symbolType: "method"`                     |
| `symbolType: "interface"` | `symbolType: "type", variant: "interface"` |
| `symbolType: "type"`      | `symbolType: "type", variant: "alias"`     |
| `symbolType: "variable"`  | `symbolType: "variable"`                   |
| `symbolType: "namespace"` | `symbolType: "module"`                     |
| `symbolType: "enum"`      | `symbolType: "enum"`                       |

### Novas Capacidades Python

| Capacidade       | Sintaxe                                      |
| ---------------- | -------------------------------------------- |
| Funções Python   | `symbolType: "function", language: "python"` |
| Dataclasses      | `symbolType: "class", variant: "dataclass"`  |
| Protocols        | `symbolType: "type", variant: "interface"`   |
| TypedDict        | `symbolType: "type", variant: "schema"`      |
| @property        | `decorator: "@property"`                     |
| @staticmethod    | `symbolType: "method", isStatic: true`       |
| @classmethod     | `symbolType: "method", variant: "classmethod"` |
| async def        | `symbolType: "function", isAsync: true`      |

### Novas Capacidades Cross-Language

| Capacidade          | Sintaxe                              |
| ------------------- | ------------------------------------ |
| Todas funções       | `symbolType: "function"`             |
| Todos tipos         | `symbolType: "type"`                 |
| Todos métodos async | `symbolType: "method", isAsync: true` |
