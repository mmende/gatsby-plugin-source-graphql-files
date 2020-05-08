const { createRemoteFileNode } = require(`gatsby-source-filesystem`)
const { basename } = require('path')
const { parse: parseUrl } = require('url')
const escapeRegExp = require('lodash.escaperegexp')
const { GraphQLClient } = require('graphql-request')

/**
 * THe default field name for static files
 */
const defaultStaticFieldName = ({ fieldName }) => `${fieldName}Static`

/*
 * The default field name for transformed fields (original field name ending with `Transformed`)
 */
const defaultTransformFieldName = ({ fieldName }) => `${fieldName}Transformed`

/**
 * The default regex to find remote url's in graphql fields
 * This regex matches the url inside markdown links and images like [My image](https://example.com/uploads/myImage.png)
 */
const defaultRegex = ({ baseUrl }) =>
  new RegExp(`${escapeRegExp(baseUrl)}[^ )]+`, 'g')

/**
 * String replacement with async callback
 */
const replaceAsync = async (str, regex, asyncFn) => {
  const promises = []
  str.replace(regex, (match, ...args) => {
    const promise = asyncFn(match, ...args)
    promises.push(promise)
  })
  const data = await Promise.all(promises)
  return str.replace(regex, () => data.shift())
}

/**
 * Adds remote file nodes
 */
const linkRemoteFiles = async ({
  typeName,
  staticFieldName,

  createResolvers,
  reporter,
}) => {
  const resolvers = {
    [typeName]: {
      [staticFieldName]: {
        type: 'File',
        resolve: async (source, args, context, info) => {
          const file = await context.nodeModel.runQuery({
            query: {
              filter: {
                internal: {
                  content: { eq: source.id },
                },
              },
            },
            type: 'File',
            firstOnly: true,
          })
          if (!file) {
            reporter.warn(
              `No static for "${source.id}". Maybe adjust your query.`
            )
            return null
          }
          file.parentId = source.id
          return file
        },
      },
    },
  }
  createResolvers(resolvers)
}

/**
 * Transform fields
 */
const transformField = async ({
  typeName,
  fieldName,
  transformedFieldName,
  regex,

  pathPrefix,
  createResolvers,
  reporter,
}) => {
  const resolvers = {
    [typeName]: {
      [transformedFieldName]: {
        type: 'String!',
        resolve: async (source, args, context, info) => {
          reporter.verbose(
            `Searching static replacement files for: ${typeName}.${transformedFieldName}`
          )
          return replaceAsync(source[fieldName], regex, async (url) => {
            reporter.verbose(`Searching static file for "${url}"`)

            const { pathname } = parseUrl(url)
            const base = basename(pathname)
            const staticFile = await context.nodeModel.runQuery({
              query: {
                filter: {
                  base: { eq: base },
                },
              },
              type: 'File',
              firstOnly: true,
            })
            if (!staticFile) {
              reporter.warn(`Missing static file for: "${url}"`)
              return url
            }
            const { internal, name, ext } = staticFile
            const staticPath = `${pathPrefix}/static/${name}-${internal.contentDigest}${ext}`
            // const { publicURL } = staticFile
            // const staticPath = publicURL
            reporter.verbose(`Found static replacement "${staticPath}"`)
            return staticPath
          })
        },
      },
    },
  }
  createResolvers(resolvers)
}

const sourceFiles = async ({
  endpoint,
  query,
  variables,
  options,
  source,

  store,
  cache,
  createNode,
  createNodeId,
  reporter,
}) => {
  const client = new GraphQLClient(endpoint, options)
  const data = await client.request(query, variables)
  const files = source(data)
  const addFilePromises = []
  for (let file of files) {
    const { url, id } = file
    addFilePromises.push(
      createRemoteFileNode({
        url,
        store,
        cache,
        createNode,
        createNodeId,
        reporter,
      }).then((node) => {
        node.internal.content = id
      })
    )
  }
  await Promise.all(addFilePromises)
}

exports.sourceNodes = async (
  { store, cache, createNodeId, reporter, actions },
  pluginOptions
) => {
  const { createNode } = actions
  let { sources = [] } = pluginOptions
  if (!Array.isArray(sources)) {
    sources = [sources]
  }

  // Query all files
  const sourceFilesPromises = []
  for (let sourceOptions of sources) {
    sourceFilesPromises.push(
      sourceFiles({
        ...sourceOptions,
        createNode,
        store,
        cache,
        createNodeId,
        reporter,
      })
    )
  }
  await Promise.all(sourceFilesPromises)
}

exports.createResolvers = async (
  { createResolvers, reporter, pathPrefix },
  pluginOptions
) => {
  let { files = [], transformFields = [] } = pluginOptions
  if (!Array.isArray(files)) {
    files = [files]
  }
  if (!Array.isArray(transformFields)) {
    transformFields = [transformFields]
  }

  // Link the file nodes to the graphql types
  const linkPromises = []
  for (let fileOptions of files) {
    const { staticFieldName = 'staticFile' } = fileOptions

    linkPromises.push(
      linkRemoteFiles({
        ...fileOptions,
        staticFieldName,
        createResolvers,
        reporter,
      })
    )
  }
  await Promise.all(linkPromises)

  // Transform fields
  const transformFieldPromises = []
  for (let transformOptions of transformFields) {
    const {
      transformFieldName = defaultTransformFieldName,
      regex = defaultRegex,
    } = transformOptions

    transformFieldPromises.push(
      transformField({
        ...transformOptions,
        transformedFieldName: transformFieldName(transformOptions),
        regex: regex(transformOptions),
        pathPrefix,
        createResolvers,
        reporter,
      })
    )
  }
  await Promise.all(transformFieldPromises)
}
