import { describe, expect, it } from "vitest"
import { chunk } from "./vue.js"

const SAMPLE_VUE = `<template>
  <button @click="onClick">{{ label }}</button>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  label: string
}

const props = defineProps<Props>()
const upper = computed(() => props.label.toUpperCase())

function greet(name: string) {
  if (!name) return ''
  return upper.value + name
}
</script>

<script>
export default {
  methods: {
    onClick() {
      return this.$emit('click')
    }
  }
}
</script>
`

describe("Vue language support", () => {
  it("chunks vue single-file components with semantic metadata", async () => {
    const chunks = await chunk(SAMPLE_VUE, "src/GreetingCard.vue")

    expect(chunks.map((c) => c.symbolName)).toEqual(
      expect.arrayContaining(["GreetingCard", "Props", "upper", "greet", "onClick"])
    )

    const componentChunk = chunks.find((c) => c.symbolType === "module")
    expect(componentChunk).toMatchObject({
      symbolName: "GreetingCard",
      symbolType: "module",
      variant: "component",
      language: "vue",
    })

    const interfaceChunk = chunks.find((c) => c.symbolName === "Props")
    expect(interfaceChunk).toMatchObject({
      symbolType: "type",
      variant: "interface",
      language: "vue",
    })

    const greetChunk = chunks.find((c) => c.symbolName === "greet")
    expect(greetChunk).toMatchObject({
      symbolType: "function",
      language: "vue",
      startLine: 15,
    })
    expect(greetChunk?.complexity).toBeGreaterThan(0)

    const clickChunk = chunks.find((c) => c.symbolName === "onClick")
    expect(clickChunk).toMatchObject({
      symbolType: "method",
      language: "vue",
    })
  })

  it("chunks template-only vue components", async () => {
    const templateOnly = `<template>
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
    <path d="M.057 24l1.687-6.163c-1.041-1.804" />
  </svg>
</template>
`

    const chunks = await chunk(templateOnly, "src/components/Whatsapp.vue")
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({
      symbolName: "Whatsapp",
      symbolType: "module",
      variant: "component",
      language: "vue",
    })
  })
})
