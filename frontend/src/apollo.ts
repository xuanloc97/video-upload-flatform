import { ApolloClient, InMemoryCache } from '@apollo/client';
// apollo-upload-client provides an Apollo terminating link that sends GraphQL multipart requests,
// which is what the backend's `Upload` scalar + graphql-upload middleware expect.
import createUploadLink from 'apollo-upload-client/createUploadLink.mjs';

/** Same-origin GraphQL endpoint (dev proxy / prod Ingress both route `/graphql` to the backend). */
export const GRAPHQL_ENDPOINT = '/graphql';

/**
 * Single Apollo Client for the whole app. All API access goes through this client (Req 9.5); only
 * binary file fetches (thumbnails, rendition playback) use plain backend file URLs.
 *
 * The upload link handles both regular operations and multipart file uploads, so `uploadVideo` and
 * the queries share one link.
 */
export function createApolloClient() {
  return new ApolloClient({
    link: createUploadLink({
      uri: GRAPHQL_ENDPOINT,
      // Apollo Server enables CSRF prevention by default, which blocks multipart (`multipart/
      // form-data`) upload requests unless a "preflight" header is present. apollo-upload-client
      // does not add it automatically, so we send it explicitly; otherwise uploads fail with
      // HTTP 400 "blocked as a potential Cross-Site Request Forgery".
      headers: { 'Apollo-Require-Preflight': 'true' },
    }),
    cache: new InMemoryCache(),
  });
}
