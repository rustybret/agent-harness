export interface ProjectEntry {
  projectId: string
  repoRoot: string
  displayName: string
  lastSeen: number
}

export interface RegistryData {
  projects: ProjectEntry[]
}

export class ProjectNotFoundError extends Error {
  constructor(public readonly projectId: string) {
    super(`No project registered for projectId: ${projectId}`)
    this.name = "ProjectNotFoundError"
  }
}
