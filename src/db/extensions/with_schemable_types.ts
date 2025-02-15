import {
    Expression,
    IdentifierNode,
    KyselyPlugin,
    OperationNode,
    OperationNodeTransformer,
    PluginTransformQueryArgs,
    PluginTransformResultArgs,
    QueryResult,
    RawNode,
    RootOperationNode,
    SchemableIdentifierNode,
    UnknownRow
} from "kysely";

export class WithSchemableTypesPlugin implements KyselyPlugin {
    #transformer: CustomWithSchemaTransformer;

    constructor(schema: string) {
        this.#transformer = new CustomWithSchemaTransformer(schema);
    }

    transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
        return this.#transformer.transformNode(args.node);
    }

    transformResult(
        args: PluginTransformResultArgs
    ): Promise<QueryResult<UnknownRow>> {
        return new Promise((resolve) => {
            resolve(args.result);
        });
    }
}

class CustomWithSchemaTransformer extends OperationNodeTransformer {
    #schema: string;

    constructor(schema: string) {
        super();
        this.#schema = schema;
    }

    protected override transformNodeImpl<T extends OperationNode>(node: T): T {
        if (RawNode.is(node)) {
            if (node.sqlFragments[0] === "_SNDWV_WITH_SCHEMA") {
                if (IdentifierNode.is(node.parameters[0])) {
                    return RawNode.createWithChild(
                        SchemableIdentifierNode.createWithSchema(
                            this.#schema,
                            node.parameters[0].name
                        )
                    ) as unknown as T;
                }
            }
        }

        return super.transformNodeImpl(node);
    }
}

export class Type<O> implements Expression<O> {
    #name: string;

    constructor(name: string) {
        this.#name = name;
    }

    get expressionType(): O | undefined {
        return undefined;
    }

    toOperationNode(): OperationNode {
        return {
            kind: "RawNode",
            sqlFragments: ["_SNDWV_WITH_SCHEMA"],
            parameters: [IdentifierNode.create(this.#name)]
        } satisfies RawNode as OperationNode;
    }
}
