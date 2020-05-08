# gatsby-plugin-source-graphql-files

Let's say you are using a headless cms like [strapi](http://strapi.de/) as content source and for your final gatsby site you want all media that points to that cms to be included statically. This is what this plugin is intended for. Furthermore it allows you to use images with [gatsby-image](https://www.gatsbyjs.org/packages/gatsby-image/).

This plugin is a work in progress and could potentially contain a lot of bugs. Contributions are very welcome.

## What about images embeded in e.g. markdown?

You can specify the `transformFields` option to add additional fields where the remote links are replaced with the static url's.

<!--
## Install

```
npm install --save gatsby-plugin-source-graphql-files
```
-->

## How to use

```js
// In your gatsby-config.js
module.exports = {
  plugins: [
    resolve: `gatsby-plugin-source-graphql-files`,
    options: {
      sources: {
        endpoint: 'https://example.com/graphql',
        query: `
          {
            files {
              id
              url
            }
          }
        `,
        source: ({ files }) => files,
      },
      files: {
        typeName: 'CMS_UploadFile',
      },
      transformFields: [
        {
          baseUrl: 'https://example.com',
          typeName: 'CMS_ComponentContentParagraph',
          fieldName: 'Content',
        },
      ],
    },
  ]
}
```

**Note:**
In order to resolve the correct file node you must include the id in your queries like so:

```graphql
{
  cms {
    files {
      id # <- Don't forget
      staticFile {
        publicURL
      }
    }
  }
}
```

## Options

### `sources`: SourceOptions | Array\<SourceOptions>

```ts
interface SourceOptions {
  endpoint: string
  query: string
  source: (queryResult: Object) => Array<{ url: string; id: string }>
  options?: Object // @see graphql-request
  variables?: Object
}
```

### `files`: FileOptions | Array\<FileOptions>

```ts
interface FileOptions {
  typeName: string
  staticFieldName?: string // @default 'staticFile'
}
```

### `transformFields`: TransformFieldOptions | Array\<TransformFieldOptions>

```ts
interface TransformFieldOptions {
  baseUrl: string
  typeName: string
  fieldName: string
  transformFieldName?: string // @default <fieldName>Transformed
  // @default ({ baseUrl }) => new RegExp(`${_.escapeRegExp(baseUrl)}[^ )]+`, 'g')
  regex?: (options: TransformFieldOptions) => RegExp
}
```

## How does it work

This plugin sources files by querying graphql endpoints for files and then utilizing `gatsby-source-filesystem` to download them. Afterwards the graphql types specified under the `files` option get an additional field that points to the downloaded file node.

For the transformation of fields a regular expression is used to identify remote file paths and replace them with their static counterpart.
