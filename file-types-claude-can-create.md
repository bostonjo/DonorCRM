# File Types Claude Can Create

A comprehensive list of file types that can be created programmatically using Claude Code's tools.

---

## Documents & Text

| Extension | Description |
|-----------|-------------|
| .txt | Plain text |
| .md | Markdown |
| .rtf | Rich text format |
| .tex | LaTeX |
| .org | Org mode |
| .rst | reStructuredText |
| .adoc | AsciiDoc |
| .log | Log files |
| .nfo | Info files |

---

## Code & Scripts

| Extension | Description |
|-----------|-------------|
| .js | JavaScript |
| .ts | TypeScript |
| .py | Python |
| .rb | Ruby |
| .go | Go |
| .rs | Rust |
| .java | Java |
| .kt | Kotlin |
| .swift | Swift |
| .c / .h | C |
| .cpp / .hpp | C++ |
| .cs | C# |
| .fs | F# |
| .scala | Scala |
| .pl | Perl |
| .php | PHP |
| .lua | Lua |
| .r / .R | R |
| .jl | Julia |
| .clj | Clojure |
| .erl | Erlang |
| .ex / .exs | Elixir |
| .hs | Haskell |
| .elm | Elm |
| .purs | PureScript |

---

## Data & Config

| Extension | Description |
|-----------|-------------|
| .json | JSON |
| .yaml / .yml | YAML |
| .xml | XML |
| .csv | Comma-separated values |
| .tsv | Tab-separated values |
| .toml | TOML |
| .ini | INI config |
| .env | Environment variables |
| .properties | Java properties |

---

## Web & Markup

| Extension | Description |
|-----------|-------------|
| .html | HTML |
| .htm | HTML (alternate) |
| .css | Cascading stylesheets |
| .scss | Sass (SCSS syntax) |
| .sass | Sass (indented syntax) |
| .less | Less CSS |
| .jsx | React JSX |
| .tsx | React TSX |
| .vue | Vue single-file components |
| .svelte | Svelte components |
| .astro | Astro components |
| .mdx | MDX (Markdown + JSX) |

---

## Shell & System

| Extension | Description |
|-----------|-------------|
| .sh | Bash script |
| .bash | Bash |
| .zsh | Zsh script |
| .fish | Fish shell |
| .ps1 | PowerShell |
| .bat | Windows batch |
| .cmd | Windows command |
| .awk | AWK script |
| .sed | Sed script |
| .cron | Crontab |

---

## Database & Query

| Extension | Description |
|-----------|-------------|
| .sql | SQL |
| .graphql | GraphQL |
| .prisma | Prisma schema |
| .mongodb | MongoDB |
| .cql | Cassandra Query Language |
| .cypher | Neo4j Cypher |
| .surql | SurrealDB |
| .sqlite | SQLite init scripts |
| .redis | Redis commands |

---

## Config & Build

| Extension | Description |
|-----------|-------------|
| .gitignore | Git ignore rules |
| .gitattributes | Git attributes |
| .editorconfig | Editor configuration |
| .prettierrc | Prettier config |
| .eslintrc | ESLint config |
| .babelrc | Babel config |
| Makefile | Make build file |
| CMakeLists.txt | CMake config |
| package.json | Node.js package |
| tsconfig.json | TypeScript config |

---

## Containers & Infrastructure

| Extension | Description |
|-----------|-------------|
| Dockerfile | Docker image definition |
| .dockerignore | Docker ignore rules |
| docker-compose.yml | Docker Compose |
| .tf / .terraform | Terraform |
| .hcl | HashiCorp Configuration Language |
| Vagrantfile | Vagrant config |
| .ansible.yml | Ansible playbooks |
| .k8s.yaml | Kubernetes manifests |
| .helm | Helm charts |
| nginx.conf | Nginx configuration |

---

## Testing & CI/CD

| Extension | Description |
|-----------|-------------|
| .spec.js | Jest spec files |
| .test.ts | Test files |
| .feature | Cucumber/Gherkin |
| .github/workflows/*.yml | GitHub Actions |
| .gitlab-ci.yml | GitLab CI |
| .travis.yml | Travis CI |
| .circleci/config.yml | CircleCI |
| Jenkinsfile | Jenkins pipeline |
| .drone.yml | Drone CI |
| azure-pipelines.yml | Azure DevOps |

---

## Mobile & Apps

| Extension | Description |
|-----------|-------------|
| .swift | iOS/Swift |
| .kt | Android/Kotlin |
| .gradle | Gradle build |
| build.gradle.kts | Kotlin Gradle |
| .plist | Apple property list |
| .pbxproj | Xcode project |
| AndroidManifest.xml | Android manifest |
| Info.plist | iOS app info |
| .entitlements | iOS entitlements |
| .xcscheme | Xcode scheme |

---

## Template Engines

| Extension | Description |
|-----------|-------------|
| .blade.php | Laravel Blade |
| .erb | Ruby ERB |
| .ejs | Embedded JavaScript |
| .hbs | Handlebars |
| .twig | Twig |
| .liquid | Liquid |
| .pug | Pug (Jade) |
| .slim | Slim |

---

## Notebooks & Docs

| Extension | Description |
|-----------|-------------|
| .ipynb | Jupyter Notebook |
| .rmd | R Markdown |
| .qmd | Quarto |
| .weave | Weave.jl |

---

## Other Formats

| Extension | Description |
|-----------|-------------|
| .svg | SVG vector graphics |
| .ics | iCalendar |
| .vcf | vCard contacts |
| .bib | BibTeX bibliography |
| .srt / .vtt | Subtitles |
| .m3u | Playlist |
| .desktop | Linux desktop entry |
| .service | systemd service |
| .pem / .key | Certificates/keys |
| .pub | Public keys |
| .htaccess | Apache config |
| .conf | Generic config |
| .cfg | Generic config |
| .lst | List files |
| .diff / .patch | Diff/patch files |
| .po / .pot | i18n translations |
| .proto | Protocol Buffers |
| .thrift | Apache Thrift |
| .avsc | Avro schema |
| .fbs | FlatBuffers |

---

## Microsoft Office Formats

| Format | Can Create? | Method |
|--------|-------------|--------|
| .csv | ✅ Yes | Native text - opens in Excel |
| .tsv | ✅ Yes | Native text - opens in Excel |
| .rtf | ✅ Yes | Plain text - Word opens it |
| .xlsx | ⚠️ Complex | ZIP of XML files |
| .docx | ⚠️ Complex | ZIP of XML files, or use `pandoc` |
| .pptx | ⚠️ Complex | ZIP of XML files |
| .xls | ❌ No | Binary format |
| .doc | ❌ No | Binary format |

### Using Pandoc for Office Formats

```bash
# Markdown to Word
pandoc input.md -o output.docx

# Markdown to PowerPoint
pandoc input.md -o output.pptx
```

---

## Google Formats

| Format | Can Create? | Notes |
|--------|-------------|-------|
| Google Docs | ❌ No | Cloud-only, requires API |
| Google Sheets | ❌ No | Cloud-only, requires API |
| Google Slides | ❌ No | Cloud-only, requires API |
| .csv (import) | ✅ Yes | Import to Google Sheets |
| .tsv (import) | ✅ Yes | Import to Google Sheets |

---

## Notes

- **Text-based files**: Can create any plain-text or text-based file format
- **Binary files**: Cannot create directly (images, PDFs, executables) without using external tools/libraries via Bash
- **Cloud formats**: Require API access (Google, Notion, etc.)
- **Compressed formats**: Modern Office formats (.xlsx, .docx) are technically ZIP archives containing XML

---

*Generated by Claude Code*
