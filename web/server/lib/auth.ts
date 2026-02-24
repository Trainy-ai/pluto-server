import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { twoFactor } from "better-auth/plugins";
import { admin } from "better-auth/plugins";
import { organization } from "better-auth/plugins";
import { sso } from "@better-auth/sso";
import { prisma } from "../lib/prisma";
import { env } from "./env";
import { sendEmail } from "./email";
import { allowedOrigins } from "./origins";

// Escape HTML to prevent XSS/HTML injection in email notifications
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Send notification email to admin when a new user signs up
async function notifyAdminOfNewSignup(user: { email: string; name: string; id: string }) {
  if (!env.ADMIN_NOTIFICATION_EMAIL) {
    return;
  }

  const signupTime = new Date().toISOString();
  const safeName = escapeHtml(user.name);
  const safeEmail = escapeHtml(user.email);
  const safeId = escapeHtml(user.id);

  const html = `
    <h2>New User Signup</h2>
    <p>A new user has signed up for mlop:</p>
    <ul>
      <li><strong>Name:</strong> ${safeName}</li>
      <li><strong>Email:</strong> ${safeEmail}</li>
      <li><strong>User ID:</strong> ${safeId}</li>
      <li><strong>Time:</strong> ${signupTime}</li>
    </ul>
  `;

  const text = `New User Signup\n\nName: ${user.name}\nEmail: ${user.email}\nUser ID: ${user.id}\nTime: ${signupTime}`;

  await sendEmail({
    to: env.ADMIN_NOTIFICATION_EMAIL,
    subject: `[mlop] New signup: ${safeEmail}`,
    html,
    text,
  });
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  appName: env.NODE_ENV === "development" ? "mlop-dev" : "mlop",
  emailAndPassword: {
    enabled: env.IS_DOCKER === "true" || env.NODE_ENV === "test" || env.NODE_ENV === "development",
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Send notification email to admin
          await notifyAdminOfNewSignup({
            email: user.email,
            name: user.name,
            id: user.id,
          });
        },
      },
    },
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
  trustedOrigins: allowedOrigins,
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
    // SSO plugin for SAML authentication (test/dev environment only)
    // Configuration based on better-auth example: https://github.com/better-auth/better-auth/blob/c8110d8881f00c1ca7af8b746de6887b48302e45/e2e/smoke/test/fixtures/tsconfig-declaration/src/demo.ts
    ...(env.NODE_ENV === "test" || env.NODE_ENV === "development"
      ? [
          sso({
            defaultSSO: [
              {
                domain: "http://localhost:3000",
                providerId: "dummyidp-test",
                samlConfig: {
                  issuer: "http://localhost:3001/api/auth/sso/saml2/sp/metadata",
                  entryPoint: env.DUMMYIDP_ENTRY_POINT || `https://dummyidp.com/apps/${env.DUMMYIDP_APP_ID}`,
                  cert: env.DUMMYIDP_CERTIFICATE || "",
                  spMetadata: {
                    metadata: `
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="http://localhost:3001/api/auth/sso/saml2/sp/metadata">
  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data>
          <ds:X509Certificate>MIIE3jCCAsYCCQDE5FzoAkixzzANBgkqhkiG9w0BAQsFADAxMQswCQYDVQQGEwJVUzEQMA4GA1UECAwHRmxvcmlkYTEQMA4GA1UEBwwHT3JsYW5kbzAeFw0yMzExMTkxMjUyMTVaFw0zMzExMTYxMjUyMTVaMDExCzAJBgNVBAYTAlVTMRAwDgYDVQQIDAdGbG9yaWRhMRAwDgYDVQQHDAdPcmxhbmRvMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA2ELJsLZs4yBH7a2U5pA7xw+Oiut7b/ROKh2BqSTKRbEG4xy7WwljT02Mh7GTjLvswtZSUObWFO5v14HNORa3+J9JT2DH+9F+FJ770HX8a3cKYBNQt3xP4IeUyjI3QWzrGtkYPwSZ74tDpAUtuqPAxtoCaZXFDtX6lvCJDqiPnfxRZrKkepYWINSwu4DRpg6KoiPWRCYTsEcCzImInzlACdM97jpG1gLGA6a4dmjalQbRtvC56N0Z56gIhYq2F5JdzB2a10pqoIY8ggXZGIJS9I++8mmdTj6So5pPxLwnCYUhwDew1/DMbi9xIwYozs9pEtHCTn1l34jldDwTziVAxGQZO7QUuoMl997zqcPS7pVWRnfz5odKuytLvQDA0lRVfzOxtqbM3qVhoLT2iDmnuEtlZzgfbt4WEuT2538qxZJkFRpZQIrTj3ybqmWAv36Cp49dfeMwaqjhfX7/mVfbsPMSC653DSZBB+n+Uz0FC3QhH+vIdNhXNAQ5tBseHUR6pXiMnLtI/WVbMvpvFwK2faFTcx1oaP/Qk6yCq66tJvPbnatT9qGF8rdBJmAk9aBdQTI+hAh5mDtDweCrgVL+Tm/+Q85hSl4HGzH/LhLVS478tZVX+o+0yorZ35LCW3e4v8iX+1VEGSdg2ooOWtbSSXK2cYZr8ilyUQp0KueenR0CAwEAATANBgkqhkiG9w0BAQsFAAOCAgEAsonAahruWuHlYbDNQVD0ryhL/b+ttKKqVeT87XYDkvVhlSSSVAKcCwK/UU6z8Ty9dODUkd93Qsbof8fGMlXeYCtDHMRanvWLtk4wVkAMyNkDYHzJ1FbO7v44ZBbqNzSLy2kosbRELlcz+P3/42xumlDqAw/k13tWUdlLDxb0pd8R5yBev6HkIdJBIWtKmUuI+e8F/yTNf5kY7HO1p0NeKdVeZw4Ydw33+BwVxVNmhIxzdP5ZFQv0XRFWhCMo/6RLEepCvWUp/T1WRFqgwAdURaQrvvfpjO/Ls+neht1SWDeP8RRgsDrXIc3gZfaD8q4liIDTZ6HsFi7FmLbZatU8jJ4pCstxQLCvmix+1zF6Fwa9V5OApSTbVqBOsDZbJxeAoSzy5Wx28wufAZT4Kc/OaViXPV5o/ordPs4EYKgd/eNFCgIsZYXe75rYXqnieAIfJEGddsLBpqlgLkwvf5KVS4QNqqX+2YubP63y+3sICq2ScdhO3LZs3nlqQ/SgMiJnCBbDUDZ9GGgJNJVVytcSz5IDQHeflrq/zTt1c4q1DO3CS7mimAnTCjetERRQ3mgY/2hRiuCDFj3Cy7QMjFs3vBsbWrjNWlqyveFmHDRkq34Om7eA2jl3LZ5u7vSm0/ylp/vtoysMjwEmw/0NA3hZPTG3OJxcvFcXBsz0SiFcd1U=</ds:X509Certificate>
        </ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>
    <md:KeyDescriptor use="encryption">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data>
          <ds:X509Certificate>MIIE3jCCAsYCCQDE5FzoAkixzzANBgkqhkiG9w0BAQsFADAxMQswCQYDVQQGEwJVUzEQMA4GA1UECAwHRmxvcmlkYTEQMA4GA1UEBwwHT3JsYW5kbzAeFw0yMzExMTkxMjUyMTVaFw0zMzExMTYxMjUyMTVaMDExCzAJBgNVBAYTAlVTMRAwDgYDVQQIDAdGbG9yaWRhMRAwDgYDVQQHDAdPcmxhbmRvMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA2ELJsLZs4yBH7a2U5pA7xw+Oiut7b/ROKh2BqSTKRbEG4xy7WwljT02Mh7GTjLvswtZSUObWFO5v14HNORa3+J9JT2DH+9F+FJ770HX8a3cKYBNQt3xP4IeUyjI3QWzrGtkYPwSZ74tDpAUtuqPAxtoCaZXFDtX6lvCJDqiPnfxRZrKkepYWINSwu4DRpg6KoiPWRCYTsEcCzImInzlACdM97jpG1gLGA6a4dmjalQbRtvC56N0Z56gIhYq2F5JdzB2a10pqoIY8ggXZGIJS9I++8mmdTj6So5pPxLwnCYUhwDew1/DMbi9xIwYozs9pEtHCTn1l34jldDwTziVAxGQZO7QUuoMl997zqcPS7pVWRnfz5odKuytLvQDA0lRVfzOxtqbM3qVhoLT2iDmnuEtlZzgfbt4WEuT2538qxZJkFRpZQIrTj3ybqmWAv36Cp49dfeMwaqjhfX7/mVfbsPMSC653DSZBB+n+Uz0FC3QhH+vIdNhXNAQ5tBseHUR6pXiMnLtI/WVbMvpvFwK2faFTcx1oaP/Qk6yCq66tJvPbnatT9qGF8rdBJmAk9aBdQTI+hAh5mDtDweCrgVL+Tm/+Q85hSl4HGzH/LhLVS478tZVX+o+0yorZ35LCW3e4v8iX+1VEGSdg2ooOWtbSSXK2cYZr8ilyUQp0KueenR0CAwEAATANBgkqhkiG9w0BAQsFAAOCAgEAsonAahruWuHlYbDNQVD0ryhL/b+ttKKqVeT87XYDkvVhlSSSVAKcCwK/UU6z8Ty9dODUkd93Qsbof8fGMlXeYCtDHMRanvWLtk4wVkAMyNkDYHzJ1FbO7v44ZBbqNzSLy2kosbRELlcz+P3/42xumlDqAw/k13tWUdlLDxb0pd8R5yBev6HkIdJBIWtKmUuI+e8F/yTNf5kY7HO1p0NeKdVeZw4Ydw33+BwVxVNmhIxzdP5ZFQv0XRFWhCMo/6RLEepCvWUp/T1WRFqgwAdURaQrvvfpjO/Ls+neht1SWDeP8RRgsDrXIc3gZfaD8q4liIDTZ6HsFi7FmLbZatU8jJ4pCstxQLCvmix+1zF6Fwa9V5OApSTbVqBOsDZbJxeAoSzy5Wx28wufAZT4Kc/OaViXPV5o/ordPs4EYKgd/eNFCgIsZYXe75rYXqnieAIfJEGddsLBpqlgLkwvf5KVS4QNqqX+2YubP63y+3sICq2ScdhO3LZs3nlqQ/SgMiJnCBbDUDZ9GGgJNJVVytcSz5IDQHeflrq/zTt1c4q1DO3CS7mimAnTCjetERRQ3mgY/2hRiuCDFj3Cy7QMjFs3vBsbWrjNWlqyveFmHDRkq34Om7eA2jl3LZ5u7vSm0/ylp/vtoysMjwEmw/0NA3hZPTG3OJxcvFcXBsz0SiFcd1U=</ds:X509Certificate>
        </ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>
    <md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="http://localhost:3001/api/auth/sso/saml2/sp/sls"/>
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="http://localhost:3001/api/auth/sso/saml2/sp/acs/dummyidp-test" index="1"/>
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="http://localhost:3001/api/auth/sso/saml2/sp/acs/dummyidp-test" index="1"/>
  </md:SPSSODescriptor>
  <md:Organization>
    <md:OrganizationName xml:lang="en-US">MLOP</md:OrganizationName>
    <md:OrganizationDisplayName xml:lang="en-US">MLOP Platform</md:OrganizationDisplayName>
    <md:OrganizationURL xml:lang="en-US">http://localhost:3001/</md:OrganizationURL>
  </md:Organization>
  <md:ContactPerson contactType="technical">
    <md:GivenName>Technical Contact</md:GivenName>
    <md:EmailAddress>technical@mlop.local</md:EmailAddress>
  </md:ContactPerson>
  <md:ContactPerson contactType="support">
    <md:GivenName>Support Contact</md:GivenName>
    <md:EmailAddress>support@mlop.local</md:EmailAddress>
  </md:ContactPerson>
</md:EntityDescriptor>
                    `,
                  },
                  idpMetadata: {
                    entityURL: `https://dummyidp.com/apps/${env.DUMMYIDP_APP_ID}/metadata`,
                    entityID: env.DUMMYIDP_ENTITY_ID || `https://dummyidp.com/apps/${env.DUMMYIDP_APP_ID}`,
                    redirectURL: env.DUMMYIDP_ENTRY_POINT || `https://dummyidp.com/apps/${env.DUMMYIDP_APP_ID}/sso`,
                    singleSignOnService: [
                      {
                        Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
                        Location: env.DUMMYIDP_ENTRY_POINT || `https://dummyidp.com/apps/${env.DUMMYIDP_APP_ID}/sso`,
                      },
                    ],
                    cert: env.DUMMYIDP_CERTIFICATE || "",
                  },
                  callbackUrl: "/dashboard",
                },
              },
            ],
          }),
        ]
      : []),
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
      : env.NODE_ENV === "test"
        ? {
            // Test environment: Simple cookie config (Vite proxy ensures same-origin)
            defaultCookieAttributes: {
              secure: false, // HTTP only in test
              httpOnly: true,
              sameSite: "lax", // Standard setting, works with Vite proxy
            },
          }
        : undefined,
});
