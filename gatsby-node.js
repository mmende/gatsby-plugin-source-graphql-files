const { createRemoteFileNode } = require(`gatsby-source-filesystem`)
const { basename } = require('path')
const { parse: parseUrl } = require('url')
const escapeRegExp = require('lodash.escaperegexp')
const { GraphQLClient } = require('graphql-request')
const fs = require('fs-extra')
const path = require('path')
const chunk = require('lodash.chunk')

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
  if(typeof str != "string"){
    return '';
  }
  const promises = []
  str.replace(regex, (match, ...args) => {
    const promise = asyncFn(match, ...args)
    promises.push(promise)
  })
  const data = await Promise.all(promises)
  return str.replace(regex, () => data.shift())
}

// @see https://github.com/gatsbyjs/gatsby/blob/master/packages/gatsby-source-filesystem/src/extend-file-node.js
const getPublicURL = ({
  getNodeAndSavePathDependency,
  file,
  context,
  pathPrefix,
}) => {
  const details = getNodeAndSavePathDependency(file.id, context.path)
  const fileName = `${file.internal.contentDigest}/${details.base}`

  const publicPath = path.join(process.cwd(), `public`, `static`, fileName)

  if (!fs.existsSync(publicPath)) {
    fs.copy(details.absolutePath, publicPath, (err) => {
      if (err) {
        console.error(
          `error copying file from ${details.absolutePath} to ${publicPath}`,
          err
        )
      }
    })
  }

  return `${pathPrefix}/static/${fileName}`
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
          const staticFile = await context.nodeModel.runQuery({
            query: {
              filter: {
                originalId: { eq: source.id },
              },
            },
            type: 'StaticGraphQLFile',
            firstOnly: true,
          })
          if (!staticFile) {
            reporter.warn(
              `No static for "${source.id}". Maybe adjust your query.`
            )
            return null
          }
          const fileId = staticFile.children[0]
          const file = await context.nodeModel.runQuery({
            query: {
              filter: {
                id: { eq: fileId },
              },
            },
            type: 'File',
            firstOnly: true,
          })
          if (!file) {
            // This should basically never happen
            reporter.warn(
              `Could not find associated static file with id "${fileId}".`
            )
            return null
          }
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
  getNodeAndSavePathDependency,
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
            const file = await context.nodeModel.runQuery({
              query: {
                filter: {
                  base: { eq: base },
                },
              },
              type: 'File',
              firstOnly: true,
            })
            if (!file) {
              reporter.warn(`Missing static file for: "${url}"`)
              return url
            }
            const publicURL = getPublicURL({
              getNodeAndSavePathDependency,
              file,
              context,
              pathPrefix,
            })
            reporter.verbose(`Found static replacement "${publicURL}"`)
            return publicURL
          })
        },
      },
    },
  }
  createResolvers(resolvers)
}

const createFileNode = async ({
  id,
  url,
  getCache,
  createNode,
  createNodeId,
  reporter,
}) => {
  const fileNode = await createRemoteFileNode({
    url,
    getCache,
    createNode,
    createNodeId,
    reporter,
  })
  // To be able to identify the file later on
  // we add a parent node with the originalId containing
  // the actual graphql id
  createNode({
    originalId: id,

    id: createNodeId(`graphql-files${id}`),
    parent: null,
    children: [fileNode.id],
    internal: {
      type: 'StaticGraphQLFile',
      contentDigest: id,
    },
  })
}

const sourceFiles = async ({
  endpoint,
  query,
  variables,
  options,
  source,
  chunkSize = 200,

  getCache,
  createNode,
  createNodeId,
  reporter,
}) => {
  const client = new GraphQLClient(endpoint, options)
  const data = await client.request(query, variables)
  const files = source(data)

  // Split the array of files to download
  // into chunks of the specified chunkSize
  const filesChunks = chunk(files, chunkSize)
  for (let filesChunk of filesChunks) {
    const addFilePromises = []
    for (let file of filesChunk) {
      const { url, id } = file
      addFilePromises.push(
        createFileNode({
          id,
          url,
          getCache,
          createNode,
          createNodeId,
          reporter,
        })
      )
    }
    await Promise.all(addFilePromises)
  }
}

exports.sourceNodes = async (
  { getCache, createNodeId, reporter, actions },
  pluginOptions
) => {
  const { createNode } = actions
  let { sources = [] } = pluginOptions
  if (!Array.isArray(sources)) {
    sources = [sources]
  }

  const sourcePromises = []
  for (let source of sources) {
    sourcePromises.push(
      sourceFiles({
        ...source,
        getCache,
        createNode,
        createNodeId,
        reporter,
      })
    )
  }

  await Promise.all(sourcePromises)
}

exports.createResolvers = async (
  { createResolvers, reporter, pathPrefix, getNodeAndSavePathDependency },
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
        getNodeAndSavePathDependency,
      })
    )
  }
  await Promise.all(transformFieldPromises)
}
