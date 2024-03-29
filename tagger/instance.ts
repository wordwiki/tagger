import * as model from "./model.ts";
import {FieldVisitorI, Field, ScalarFieldBase, BooleanField, IntegerField, FloatField,
        StringField, IdField, PrimaryKeyField, RelationField, Schema} from "./model.ts";
import {unwrap, panic} from "../utils/utils.ts";
import * as utils from "../utils/utils.ts";
import {dictSchemaJson} from "./entry-schema.ts";
import { Assertion, getAssertionPath, selectAssertionsForTopLevelFact, compareAssertionsByOrderKey, compareAssertionsByRecentness } from "./schema.ts";
import * as timestamp from "../utils/timestamp.ts";
import {BEGINNING_OF_TIME, END_OF_TIME} from '../utils/timestamp.ts';
import {assert} from '../utils/utils.ts';
import * as view from './view.ts';
import * as orderkey from '../utils/orderkey.ts';
import { renderToStringViaLinkeDOM } from '../utils/markup.ts';
import {block} from "../utils/strings.ts";

export type Tag = string;

// - Get working first, then refactor.
// - write simple test stuff, probably also beaters, round trip MMO etc.
// - make API be nice.
// - figure out (client side) id allocator.  Also needs to support distributed
//   operation.   maybe add a nanoid to every fact.  Or pool of reserved ids for
//   remote - but hard to do with partitioning (can use a rename pass instead?)

// TODO 

// Perhaps the versioned relation tree should be forced??

// /**
//  *
//  */
// export class VersionedRelationContainer {
//     readonly schema: RelationField;
//     readonly childRelations: Record<Tag,VersionedRelation>;

//     constructor(schema: RelationField) {
//         this.schema = schema;
//         this.childRelations = Object.fromEntries(
//             schema.relationFields.map(r=>[r.tag, new VersionedRelation(r, this)]));
//     }

// }


/*
  - would like typed access to the tree, including rich apis (meaning that
  we don't want to have the typed access by doing a copy of the tree).
  - don't want to use proxies
  - can take advantage of the relative immutability.
  - the shape below is wrong anyway for a multi-versioned tree.
  - 
 */

// Maybe variant is universal?  --- PROBABLY!  --- CAN JUST BURY EVERYWHERE THEN!
// interface VariantTupleVerisonT extends TupleVersionT {
//     variant: string;
// }

// How does root work?
// - the mode-consistent way would be to have a root tuple id (for example 0),
//   and then normal model would work from there.
// - there would be versioned data for this root tuple.
// - the type and id would be fixed (by the schema).
// - we could just forbid tuples at this level (and have an empty tuple
//   at the top) so that we can have a more consistent model.
// - problem is with lifetimes, which we need to figure out in general.
// - specifically, we have decoupled child lifetimes from parent tuple lifetimes,
//   but how do we handle children/decendants if the parent is deleted/not present.
// - from a user perspective, deleting the parent should delete the children - which
//   means the parent lifetime would effect the children.
// - this means that usual tree access will need to be parameterized by when.
// - anyway, this also means that if we want to have a unified root model,
//   we probably want to make a record for it.
// - not a bad thing to have for a dictionary anyway.
// - not super bad for export.
// - probably add to ty/id path thing just for consistency.


// - how does visibility work with a locale view?
// - if there is no tuple in the current locale, then we don't see children.

type FilterConditionally<Source, Condition> = Pick<Source, {[K in keyof Source]: Source[K] extends Condition ? K : never}[keyof Source]>;

type ArrayElemType<T extends any[]> = T[number];

let k: number[] = [1,2,3];
type FFF = ArrayElemType<typeof k>;


//type TupleType<T extends {$tuples: any[]}> = T["$tuples"][0];
type TupleType<T extends {$tuples: any[]}> = ArrayElemType<T["$tuples"]>;

// type ChildRelationsType<T, F extends {[n:string]: NodeT[]}=FilterConditionally<Omit<T, '$tuples'>, NodeT[]>> = {
//     [Property in keyof F]: VersionedRelation<ArrayElemType<F[Property]>>
// };

// type ChildRelationsType<T> =
//     Pick<T, {[K in keyof T]: T[K] extends NodeT[] ? K : never}[keyof T]>;

// type ChildRelationsType<T> = {
//     [Property in keyof Pick<T, {[K in keyof T]: T[K] extends NodeT[] ? K : never}[keyof T]>]: VersionedRelation<T[Property] extends NodeT[] ? T[Property][number] : never>
// };



//     [Property in keyof T]: VersionedRelation<ArrayElemType<T[Property]>>
// };

interface Foo {
    //a: Cat;
    b: string;
}



interface NodeT {
    isNodeT?: boolean;
}

/**
 * 
 */
interface Node<TupleT extends TupleVersionT> extends NodeT {
    $tuples: TupleT[];
}

/**
 *
 */
interface TupleVersionT {
    assertion_id: number;
    id: number;
    valid_from: number;
    valid_to: number;
}

interface DictionaryNode extends Node<Dictionary> {
    entry: EntryNode[];
    spelling: SpellingNode[];
    bar: string;
}

//type S1 = FilterConditionally<DictionaryNode, NodeT[]>;
//type S = ChildRelationsType<DictionaryNode>;

// let z: ChildRelationsType<DictionaryNode> = { entry: undefined as VersionedRelation<EntryNode> };

let x: TupleType<DictionaryNode>;
//(void)d;

interface Dictionary extends TupleVersionT {
}

interface EntryNode extends Node<Entry> {
    spelling: SpellingNode[];
    subentry: SubentryNode[];
}

//let d: ChildRelationsType<EntryNode> = { spelling: [], subentry: [] };
//(void)d;

interface Entry extends TupleVersionT {
}

interface SpellingNode extends Node<Spelling> {
}

interface Spelling extends TupleVersionT {
    text: string;
}

interface SubentryNode extends Node<Subentry> {
    definition: DefinitionNode[];
    //gloss: GlossNode[];
    // example: Example[];
    // recording: Recording[];
    // pronunication_guide: PronunciationGuide[];
    // category: Category[];
    // related_entry: RelatedEntry[];
    // alternate_grammatical_form: AlternateGrammaticalForm[];
    // other_regional_form: OtherRegionalForm[];
    // attr: Attr[];
}

interface Subentry extends TupleVersionT {
    part_of_speech: string;
}

interface DefinitionNode extends Node<Definition> {
    // ...
}

interface Definition extends TupleVersionT {
    definition: string;
}

interface Gloss extends TupleVersionT {
    gloss: string;
}

// interface Subentry extends Node {
//     part_of_speech: string;
//     definition: Definition[];
// }

// interface Definition extends Node {
//     definition: string;
// }


//let k: Entry.

// VersionedTuple can take a type parameter:
// -


// -------------------------------------------------------------------------------
// -------------------------------------------------------------------------------
// -------------------------------------------------------------------------------

/**
 *
 */
export class VersionedTuple/*<T extends NodeT>*/ {
    readonly id: number;
    readonly schema: RelationField;
    readonly tupleVersions: TupleVersion[] = [];
    readonly childRelations: Record<Tag,VersionedRelation>;
    //readonly childRelations: ChildRelationsType<NodeT>;
    #currentTuple: TupleVersion|undefined = undefined;

    constructor(schema: RelationField, id: number) {
        this.schema = schema;
        this.childRelations = Object.fromEntries(
            schema.relationFields.map(r=>[r.tag, new VersionedRelation(r, this)]));
        this.id = id;
    }

    applyAssertionByPath(path: [string, number][], assertion: Assertion, index: number=0) {
        const versionedTuple = this.getVersionedTupleByPath(path);
        versionedTuple.applyAssertion(assertion);
    }

    getVersionedTupleByPath(path: [string, number][], index: number=0): VersionedTuple {
        //console.info('PATH is', path, path[index], index, 'SELF is', this.schema.tag, 'child is', this.schema.relationFields.map(r=>r.tag), 'self type', utils.className(this));
        const [ty, id] = path[index];

        const versionedRelation = this.childRelations[ty];
        if(!versionedRelation) {
            throw new Error(`unexpected tag ${ty} -- FIX ERROR NEED LOCUS ETC`);
        }
        utils.assert(versionedRelation.schema.tag === ty);

        let versionedTuple = versionedRelation.tuples.get(id);
         if(!versionedTuple) {
             versionedTuple = new VersionedTuple(versionedRelation.schema, id);
             versionedRelation.tuples.set(id, versionedTuple);
        }
        utils.assert(versionedTuple.schema.tag === ty);
        
        if(index+1 === path.length)
            return versionedTuple;
        else
            return versionedTuple.getVersionedTupleByPath(path, index+1);
    }

    forEachVersionedTuple(f: (r:VersionedTuple)=>void) {
        f(this);
        for(const v of Object.values(this.childRelations))
            v.forEachVersionedTuple(f);
    }

    findVersionedTuples(filter: (r:VersionedTuple)=>boolean): Array<VersionedTuple> {
        const collection: VersionedTuple[] = [];
        this.forEachVersionedTuple(t=>{
            if(filter(t))
                collection.push(t);
        });
        return collection;
    }

    findVersionedTupleById(id: number): VersionedTuple|undefined {
        let found: VersionedTuple|undefined;
        this.forEachVersionedTuple(t=>{
            if(t.id === id) {
                if(found !== undefined)
                    throw new Error(`multiple tuples found for id ${id}`);
                found = t;
            }
        });
        return found;
    }

    findRequiredVersionedTupleById(id: number): VersionedTuple {
        const tuple = this.findVersionedTupleById(id);
        if(tuple === undefined)
            throw new Error(`failed to find required versioned tuple for id ${id}`);
        return tuple;
    }
    
    applyAssertion(assertion: Assertion) {
        const tuple = new TupleVersion(this, assertion);
        // TODO lots of validation here + index updating etc.
        // TODO update current.
        // TODO tie into speculative mechanism.
        const mostRecentTuple = this.mostRecentTuple;
        if(mostRecentTuple) {
            if(mostRecentTuple.assertion.valid_to) {
                if(tuple.assertion.valid_from !== mostRecentTuple.assertion.valid_to) {
                    throw new Error(`FIX ERROR: valid_from chain broken`);
                }
            } else {
                // This is tricky - we should probably mute the valid_to on the previous
                //  most current tuple - but this complicates undo etc.  The fact that
                //  valid_to with a non-null value is also used for undo complicates things.
                if(mostRecentTuple.assertion.valid_from <= tuple.assertion.valid_from) {
                    throw new Error(`FIX ERROR: time travel prolbem`);
                }
            }
        }
        
        this.tupleVersions.push(tuple);
        if(tuple.isCurrent)
            this.#currentTuple = tuple;
    }

    get mostRecentTuple() {
        // Note: we are making use of the JS behaviour where out of bound index accesses return undefined.
        return this.tupleVersions[this.tupleVersions.length-1];
    }

    
    // forEachVersionedTuple(f: (r:VersionedTuple)=>void) {
    //     f(this);
    //     super.forEachVersionedTuple(f);
    // }

    dump(): any {
        return {
            //type: this.schema.name,
            //id: this.id,
            versions: this.tupleVersions.map(a=>a.dump()),
            ...Object.fromEntries(Object.values(this.childRelations).map(c=>
                [c.schema.name, c.dump()]))
        };
    }
}

/**
 *
 *
 * - need to handle views of the content based on time + variant
 * - ordering of view needs to also be time based.
 * - need to track local (uncommitted) insertions etc.
 */
export class VersionedRelation/*<T extends NodeT>*/ {
    readonly schema: RelationField;
    readonly parent: VersionedTuple;
    readonly tuples: Map<number,VersionedTuple/*<T>*/> = new Map();

    constructor(schema: RelationField, parent: VersionedTuple) {
        this.schema = schema;
        this.parent = parent;
    }

    forEachVersionedTuple(f: (r:VersionedTuple)=>void) {
        for(const v of this.tuples.values())
            v.forEachVersionedTuple(f);
    }

    dump(): any {
        return Object.fromEntries([...this.tuples.entries()].map(([id, child])=>
            [id, child.dump()]));
    }
}



/**
 *
 */
export class TupleVersion {
    readonly relation: VersionedTuple;
    readonly assertion: Assertion;
    
    #domainFields: Record<string,any>|undefined = undefined;
    //#changeRegistrations

    constructor(relation: VersionedTuple, assertion: Assertion) {
        this.relation = relation;
        this.assertion = assertion;
    }

    get isCurrent(): boolean {
        return this.assertion.valid_to === timestamp.END_OF_TIME;
    }
    
    get domainFields(): Record<string,any> {
        // TODO: consider checking type of domain fields.
        // TODO: fix the 'as any' below
        return this.#domainFields ??= Object.fromEntries(
            this.relation.schema.scalarFields.map(f=>[f.name, (this.assertion as any)[f.bind]]));
    }

    dump(): any {
        const a = this.assertion;
        return {
            ...(a.valid_from !== timestamp.BEGINNING_OF_TIME ?
                {valid_from: timestamp.formatTimestampAsUTCTime(a.valid_from)} : {}),
            ...(a.valid_to !== timestamp.END_OF_TIME ?
                {valid_to: timestamp.formatTimestampAsUTCTime(a.valid_to)} : {}),
            //id: this.relation.id,
            //ty: this.relation.schema.tag,
            ...this.domainFields,
        };
    }
}

export function compareVersionedTupleByRecentness(a: TupleVersion, b: TupleVersion): number {
    return compareAssertionsByRecentness(a.assertion, b.assertion);
}

export function compareVersionedTupleAssertionByOrderKey(a: TupleVersion, b: TupleVersion): number {
    return compareAssertionsByOrderKey(a.assertion, b.assertion);
}

/**
 *
 */
export abstract class VersionedTupleQuery {
    readonly src: VersionedTuple;
    readonly schema: RelationField;
    readonly tupleVersions: TupleVersion[];
    readonly childRelations: Record<Tag,VersionedRelationQuery> = {};
    
    constructor(src: VersionedTuple) {
        this.src = src;
        this.schema = src.schema;
        this.tupleVersions = this.computeTuples();
        this.childRelations = this.computeChildRelations();
    }

    abstract computeTuples(): TupleVersion[];
    abstract computeChildRelations(): Record<Tag, VersionedRelationQuery>;

    get mostRecentTupleVersion(): TupleVersion|undefined {
        // Note: we are using the spec behaviour where out of bound [] refs === undefined.
        return this.tupleVersions[this.tupleVersions.length-1];
    }

    get historicalTupleVersions(): TupleVersion[] {
        return this.tupleVersions.slice(0, -1);
    }
    
    dump(): any {
        return {
            //type: this.schema.name,
            //id: this.id,
            versions: this.tupleVersions.map(a=>a.dump()),
            ...Object.fromEntries(Object.values(this.childRelations).map(c=>
                [c.src.schema.name, c.dump()]))
        };
    }
}

/**
 *
 */
export class CurrentTupleQuery extends VersionedTupleQuery {
    declare childRelations: Record<Tag, CurrentRelationQuery>;
    
    constructor(src: VersionedTuple) {
        super(src);
    }
    
    // Note: we will probably switch VersionTuple to have a ordered by
    //       recentness query, in which case we should remove the sort from here.
    computeTuples(): TupleVersion[] {
        return this.src.tupleVersions.
            filter(tv=>tv.isCurrent).
            toSorted(compareVersionedTupleByRecentness);
    }

    computeChildRelations(): Record<Tag, VersionedRelationQuery> {
        return Object.fromEntries(Object.entries(this.src.childRelations).
                map(([tag,rel])=>
                    [tag, new CurrentRelationQuery(rel)]));
    }
}

/**
 *
 */
export abstract class VersionedRelationQuery {
    readonly src: VersionedRelation;
    readonly schema: RelationField;
    readonly tuples: Map<number,VersionedTupleQuery>;
    
    constructor(src: VersionedRelation) {
        this.src = src;
        this.schema = src.schema;
        this.tuples = this.computeTuples();
    }

    abstract computeTuples(): Map<number, VersionedTupleQuery>;

    dump(): any {
        return Object.fromEntries([...this.tuples.entries()].map(([id, child])=>
            [id, child.dump()]));
    }
}
    
/**
 *
 * TODO: hook up versioned parent.
 */
export class CurrentRelationQuery extends VersionedRelationQuery {
    declare tuples: Map<number,CurrentTupleQuery>;
    
    constructor(src: VersionedRelation) {
        super(src);
    }

    computeTuples(): Map<number, CurrentTupleQuery> {
        const currentTupleQuerys = [...this.src.tuples.entries()].
            map(([id,tup]: [number, VersionedTuple]): [number, CurrentTupleQuery]=>
                [id, new CurrentTupleQuery(tup)]);
        
        const currentTupleQuerysByRecentness =
            currentTupleQuerys.toSorted(([aId, aTup]: [number, CurrentTupleQuery], [bId, bTup]: [number, CurrentTupleQuery]) => {
                const aMostRecent = aTup.mostRecentTupleVersion;
                const bMostRecent = bTup.mostRecentTupleVersion;
                if(aMostRecent === undefined && bMostRecent === undefined) return 0;
                if(aMostRecent === undefined) return -1;
                if(bMostRecent === undefined) return 1;
                return compareVersionedTupleByRecentness(aMostRecent, bMostRecent);
            });

        return new Map(currentTupleQuerysByRecentness);
    }
}

// /**
//  *
//  */
// export class VersionedDatabaseWorkspace extends VersionedRelationContainer {
//     declare schema: Schema;
    
//     //readonly factsById: Map<number, FactCollection> = new Map();
    
//     constructor(schema: Schema) {
//         super(schema);
//     }

//     apply(assertion: Assertion) {
//         // We want to be able to apply assertions at any depth, in any order.
//         // - Top level apply will lookup RelationField for ty (using index on schema),
//         //   and then traversal will walk/create nodes, then apply to fact.
//         // - top level is still a container even if we are only mirroring a single
//         //   record.
//         // const relationField = this.schema.relationsByTag[assertion.ty];
//         // if(!relationField)
//         //     throw new Error(`Failed to find relation with tag '${assertion.ty}' in schema ${this.schema.name}`);

//         return this.applyAssertionByPath(getAssertionPath(assertion), assertion);
//     }

//     dump(): any {
//         return Object.fromEntries(Object.entries(this.childRelations).map(([id, child])=>
//             [id, child.dump()]));
//     }

//     // dump(): any {
//     //     return Object.values(this.childRelations).map(child=>({
//     //         type: child.schema.name: child.dump()}));
//     // }
    
// }


/**
 *
 */
export function testRenderEntry(assertions: Assertion[]): any {
    
    const dictSchema = model.Schema.parseSchemaFromCompactJson('dict', dictSchemaJson);

    console.info('Sample entry assertions', assertions);

    // --- Create an empty instance schema
    //const mmoDb = new VersionedDatabaseWorkspace(dictSchema);
    const mmoDb = new VersionedTuple/*<DictionaryNode>*/(dictSchema, 0);
    assertions.forEach(a=>mmoDb.applyAssertionByPath(getAssertionPath(a), a));
    console.info('MMODB', JSON.stringify(mmoDb.dump(), undefined, 2));

    const entries = mmoDb.childRelations['en'];
    //console.info('entries', entries);
    
    // --- Navigate to definition
    let definition = mmoDb.findRequiredVersionedTupleById(992);
    console.info('definition', definition.dump());

    const current = new CurrentTupleQuery(mmoDb);
    console.info('current view', JSON.stringify(current.dump(), undefined, 2));

    const mmoView = view.schemaView(dictSchema);

    return view.renderTuple(mmoView, current);
}

/**
 *
 */
export function test(entry_id: number=1000): any {
    // --- Load the tuples for a dictionary entry.
    const sampleEntryAssertions = selectAssertionsForTopLevelFact('dict').all({id1:entry_id});
    return (
        ['html', {},
         ['head', {},
          ['link', {href: '/resources/instance.css', rel:'stylesheet', type:'text/css'}],
          /*['script', {src:'/scripts/tagger/page-editor.js'}]*/],
         ['body', {},
          testRenderEntry(sampleEntryAssertions)]]);
}

/**
 *
 */
function clientRenderTest(entry_id: number): any {
    return (
        ['html', {},
         ['head', {},
          ['link', {href: '/resources/instance.css', rel:'stylesheet', type:'text/css'}],
          ['script', {src:'/scripts/tagger/instance.js', type: 'module'}],
          ['script', {type: 'module'}, block`
/**/           import * as instance from '/scripts/tagger/instance.js';
/**/           document.addEventListener("DOMContentLoaded", (event) => {
/**/             console.log("DOM fully loaded and parsed");
/**/             instance.renderSample(document.getElementById('root'))
/**/           });`
          ]
        ],
        
        ['body', {},
         ['div', {id: 'root'}, entry_id]]]);
}

console.info('HI FROM INSTANCE!');

export function renderSample(root: Element) {
    console.info('rendering sample');
    root.innerHTML = 'POW!';

    

    
}

export function getAssertionsForEntry(entry_id: number): any {
    return selectAssertionsForTopLevelFact('dict').all({id1: entry_id});
}

export const routes = ()=> ({
    instanceTest: test,
    clientRenderTest,
    getAssertionsForEntry,
});




if (import.meta.main)
    await test();
