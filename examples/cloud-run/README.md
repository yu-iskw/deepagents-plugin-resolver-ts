# Cloud Run example

Plugins are resolved and compiled during the image build; the running
container only ever loads the immutable, digest-verified bundle. See the
Dockerfile in this directory.

Key properties (RFC section 20):

- no runtime Git/npm/network resolution — a broken marketplace cannot stop
  a cold start;
- the revision is reproducible from the image digest;
- plugin updates produce a new image and a new revision;
- source credentials exist only in the build stage.
