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

### Configuration example

```js
// In your gatsby-config.js
module.exports = {
  plugins: [
    `gatsby-source-filesystem`,
    {
      resolve: 'gatsby-source-graphql',
      options: {
        typeName: 'CMS',
        fieldName: 'cms',
        url: `https://example.com/graphql`,
      },
    },
    {
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
    }
  ]
}
```

### Querying

In order to know which static file belongs to which GraphQL node the plugin requires the `id` to be also queried for each file like so:

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

The same problem has to be fixed for transformed fields by including the original field in your query like so:

```graphql
{
  cms {
    page(id: "42") {
      Content # <- Base field as specified in `transformFields`. Required to know the content to transform
      content: ContentTransformed
    }
  }
}
```

Also don't use aliases for `id` or the original field name.

## Options

### `sources`: SourceOptions | Array\<SourceOptions>

```ts
interface SourceOptions {
  endpoint: string // Graphql endpoint
  query: string // Query to fetch url's and id's
  // A function to map the query result to an array of url's and id's
  source: (queryResult: Object) => Array<{ url: string; id: string }>
  options?: Object // @see graphql-request
  variables?: Object
}
```

### `files`: FileOptions | Array\<FileOptions>

```ts
interface FileOptions {
  typeName: string // Graphql type that will get the static field added
  staticFieldName?: string // @default 'staticFile'
}
```

### `transformFields`: TransformFieldOptions | Array\<TransformFieldOptions>

```ts
interface TransformFieldOptions {
  baseUrl: string // Url that will be used in the regex to find remote file url's
  typeName: string // Graphql type to add transformation field
  fieldName: string // The field that contains the content to transform
  transformFieldName?: string // @default <fieldName>Transformed
  /*
   * Functiont that produces a regular expression to match remote url's
   * @default ({ baseUrl }) => new RegExp(`${_.escapeRegExp(baseUrl)}[^ )]+`, 'g')
   */
  regex?: (options: TransformFieldOptions) => RegExp
}
```

## How does it work

This plugin sources files by querying graphql endpoints for files and then utilizing `gatsby-source-filesystem` to download them. Afterwards the graphql types specified under the `files` option get an additional field that points to the downloaded file node.

For the transformation of fields a regular expression is used to identify remote file paths and replace them with their static counterpart.
