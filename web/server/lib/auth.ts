import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { twoFactor } from "better-auth/plugins";
import { admin } from "better-auth/plugins";
import { organization } from "better-auth/plugins";
import { prisma } from "../lib/prisma";
import { env } from "./env";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  appName: env.NODE_ENV === "development" ? "mlop-dev" : "mlop",
  emailAndPassword: {
    enabled: env.IS_DOCKER === "true",
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google", "github"],
    },
  },
  secret: env.BETTER_AUTH_SECRET,
  socialProviders: {
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      redirectURI:
        env.NODE_ENV === "production" && env.PUBLIC_URL
          ? `${env.PUBLIC_URL}/api/auth/callback/github`
          : "http://localhost:3001/api/auth/callback/github",
    },
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectURI:
        env.NODE_ENV === "production" && env.PUBLIC_URL
          ? `${env.PUBLIC_URL}/api/auth/callback/google`
          : "http://localhost:3001/api/auth/callback/google",
    },
  },
  trustedOrigins: [env.PUBLIC_URL],
  user: {
    additionalFields: {
      finishedOnboarding: {
        type: "boolean",
        required: false,
        default: false,
        input: false,
      },
    },
  },
  plugins: [
    twoFactor(),
    admin(),
    organization({
      allowUserToCreateOrganization: async (user) => {
        return false;
      },
      sendInvitationEmail: async (invitation) => {
        console.log("sendInvitationEmail", invitation);
      },
    }),
  ],
  advanced:
    env.VERCEL === "1"
      ? {
          crossSubDomainCookies: {
            enabled: true,
            domain: ".trainy.ai",
          },
          defaultCookieAttributes: {
            secure: true,
            httpOnly: true,
            sameSite: "none",
            partitioned: true,
          },
        }
      : undefined,
});
