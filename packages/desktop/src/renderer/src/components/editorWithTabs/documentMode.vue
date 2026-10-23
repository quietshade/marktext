<template>
  <div
    v-if="currentFile"
    class="document-mode"
  >
    <span
      role="status"
      aria-live="polite"
    >
      {{ t(currentFile.readOnly ? 'readingMode.title' : 'readingMode.edit') }}
    </span>
    <button
      type="button"
      class="plain-button document-mode-toggle"
      :disabled="currentFile.modeChanging"
      :aria-pressed="currentFile.readOnly"
      @click="toggleMode"
    >
      {{ t(currentFile.readOnly ? 'readingMode.unlock' : 'readingMode.lock') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useEditorStore } from '@/store/editor'
import { nextTick } from 'vue'

const { t } = useI18n()
const editorStore = useEditorStore()
const { currentFile } = storeToRefs(editorStore)

const toggleMode = async(event: MouseEvent) => {
  const file = currentFile.value
  if (!file) return
  const button = event.currentTarget as HTMLButtonElement
  const restoreFocus = document.activeElement === button
  await editorStore.SET_READ_ONLY(file.id, !file.readOnly)
  await nextTick()
  if (restoreFocus && button.isConnected) button.focus()
}
</script>

<style scoped>
.document-mode {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  min-height: 28px;
  padding: 2px 12px;
  color: var(--editorColor);
  background: var(--editorBgColor);
  border-top: 1px solid var(--editorColor10);
  font-size: 12px;
}
.document-mode-toggle {
  padding: 4px 8px;
  border-radius: 4px;
  color: inherit;
}
.document-mode-toggle:hover {
  background: var(--floatHoverColor);
}
.document-mode-toggle:focus-visible {
  outline: 2px solid var(--themeColor);
  outline-offset: 1px;
}
.document-mode-toggle:disabled {
  opacity: 0.6;
}
</style>
