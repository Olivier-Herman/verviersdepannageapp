import NextAuth from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      name?: string | null
      image?: string | null
      role: string
      azureId: string
      modules: string[]
    }
  }

  interface JWT {
    userId: string
    role: string
    azureId: string
    modules: string[]
  }
}
