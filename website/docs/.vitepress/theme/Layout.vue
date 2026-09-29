<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import RepoStar from './components/RepoStar.vue'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <template #nav-bar-content-after>
      <RepoStar />
    </template>
  </Layout>
</template>
