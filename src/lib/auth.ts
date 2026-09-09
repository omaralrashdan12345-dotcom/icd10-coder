import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

/**
 * Lightweight credentials-based auth.
 *
 * A single hardcoded user "Omar" is supported for demo purposes. The
 * password is intentionally permissive — this is NOT production-grade.
 * Replace with a real user store (Prisma + bcrypt) before any production
 * deployment.
 */

const USERS = [
  {
    id: "1",
    name: "Omar",
    email: "omar@icd10-coder.local",
    username: "omar",
    // Demo password — accept either this or any non-empty value for the demo
    password: "omar123",
    role: "coder",
  },
] as const;

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const username = credentials?.username?.trim().toLowerCase();
        const password = credentials?.password ?? "";
        if (!username) return null;

        const user = USERS.find((u) => u.username === username);
        if (!user) return null;

        // Demo: accept the real password OR any non-empty password (so the
        // user can log in quickly without remembering the exact password).
        if (password.length === 0) return null;
        if (password !== user.password && password.length < 3) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        } as any;
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
  pages: {
    // We don't use a separate login page — login is inline on `/`.
    signIn: "/",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role ?? "coder";
        token.username = (user as any).email?.split("@")[0] ?? "omar";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = token.role;
        (session.user as any).username = token.username;
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET || "icd10-coder-dev-secret-change-me-in-production-9f3a7c2e",
};

export const DEMO_USERNAME = "omar";
export const DEMO_PASSWORD = "omar123";
